// Compares two builds of Bun by instruction counts: every small benchmark, and one request of every route of every server.
//
//   bun test/aot/perf/compare-builds.ts --before <bun> --after <bun>
//       [--threshold 2] [--only <regular expression>] [--sizes small,called,very-large] [--servers bun,node,hono | none]
//       [--modules <node_modules>] [--jobs 16] [--out <folder>] [--build-flag <flag>]..
//
// It prints the rows that got slower by more than the threshold, worst first, then the rows that got faster, and exits with 1 if any row got slower.
// ./README.md explains how to read the output and what to do about a row.
//
// --before and --after each take a Bun executable, or a folder that an earlier run wrote with --out: measure a baseline once, compare many builds with it.
// --out <folder> keeps `<folder>/before` and `<folder>/after`, one `rows.tsv` each.
// --build-flag goes to every `bun build --compile --aot` of --after only: with the same Bun on both sides, that is what a compiler flag costs.
//
// Needs Linux and user-mode hardware counters (`kernel.perf_event_paranoid` at 2 or below). Instructions are counted in user mode over the whole process, so the
// numbers are the same on a busy machine. The servers need their packages: npm once for each side, or --modules <an installed node_modules of ../servers/app>.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "fs";
import { availableParallelism, tmpdir } from "os";
import { join, resolve } from "path";
import { parseArgs } from "util";
import { openInstructionCounter } from "../analysis-scaling/measure-check";
import { routes as routesOfTheServers, type Route } from "../servers/answers";
import { idiomsAgainstTheJit, isWhole } from "./measure-idioms";

/** One measured number. `yardstick` is the same work under the same binary's JIT: when it moves like the row, the runtime changed and not the compiler. */
export type Reading = { instructions: number; yardstick?: number };
export type Readings = Map<string, Reading>;
export type Change = { name: string; before: number; after: number; percent: number; runtimeMovedToo: boolean };

// The same text is compiled differently depending on what surrounds it.
//   small       the benchmark is the whole program, and its loop calls turn() directly
//   called      the loop finds turn() at run time, so turn() is compiled as a function that somebody calls, not as part of the loop
//   very-large  the same, compiled as it would be inside a very large program, where little counts as code that runs often
export const sizes = {
  "small": {},
  "called": { inVeryLargeProgram: true, buildFlags: ["--aot-limit=MaxWarmCodeValues:1048576"] },
  "very-large": { inVeryLargeProgram: true, buildFlags: [] as string[] },
};
export type Size = keyof typeof sizes;
export const allServers = ["bun", "node", "hono", "elysia", "express", "fastify", "koa"];

// Benchmarks that cost one of two amounts from run to run, several percent apart, with one and the same executable. They are measured, and listed apart.
export const unsteadyBenchmarks =
  /names-seen\.one-of-256|weak-|new-view|stringify-|-add-and-delete|replace-all-markers|buffer-index-loop|create-an-object-below|error-told-apart-by-instanceof|decode-a-chunk-of-a-stream/;

const steadyEnvironment = {
  NO_COLOR: "1",
  BUN_ENABLE_CRASH_REPORTING: "0",
  DO_NOT_TRACK: "1",
  BUN_GC_TIMER_DISABLE: "1",
  BUN_JSC_percentCPUPerMBForEdenTimer: "0",
  BUN_JSC_percentCPUPerMBForFullTimer: "0",
  BUN_JSC_useConcurrentGC: "0",
  BUN_JSC_numberOfGCMarkers: "1",
};

// What a hash table keyed by addresses costs depends on where the system puts the heap. At fixed addresses two starts of a server do the same work.
const withoutAddressRandomization = Bun.which("setarch") ? ["setarch", process.arch === "arm64" ? "aarch64" : "x86_64", "-R"] : [];

async function inParallel<T>(jobs: number, items: T[], work: (item: T) => Promise<void>) {
  const waiting = [...items];
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let item = waiting.shift(); item !== undefined; item = waiting.shift()) await work(item);
    }),
  );
}

/** Instructions per turn of every benchmark whose name matches, as TypeScript (`typed`) and as JavaScript (`untyped`). */
export async function measureBenchmarks(
  bun: string,
  folder: string,
  size: Size,
  { only = /./, jobs = availableParallelism(), buildFlags = [] as string[] } = {},
): Promise<Readings> {
  const { inVeryLargeProgram = false, buildFlags: flagsOfSize = [] } = sizes[size] as {
    inVeryLargeProgram?: boolean;
    buildFlags?: string[];
  };
  mkdirSync(folder, { recursive: true });
  const { names, measure } = idiomsAgainstTheJit(bun, folder, {
    collections: false,
    inVeryLargeProgram,
    buildFlags: [...flagsOfSize, ...buildFlags],
  });
  const readings: Readings = new Map();
  await inParallel(
    jobs,
    names.filter(name => only.test(name)),
    async name => {
      const row = await measure(name);
      if (row.failure) console.error(`FAILS ${size} ${name}: ${row.failure}`);
      if (!isWhole(row)) return;
      for (const form of ["typed", "untyped"] as const)
        readings.set(`${size} ${form} ${name}`, {
          instructions: row[form].instructions,
          yardstick: row.jit.instructions,
        });
    },
  );
  return readings;
}

/** Copies the servers' sources into `folder` and gives them their packages. */
export function prepareServers(bun: string, folder: string, modules?: string) {
  cpSync(join(import.meta.dir, "..", "servers", "app"), folder, { recursive: true });
  if (modules) symlinkSync(resolve(modules), join(folder, "node_modules"));
  else {
    const install = Bun.spawnSync({ cmd: [bun, "install", "--ignore-scripts"], cwd: folder, stdout: "pipe", stderr: "pipe" });
    if (install.exitCode !== 0) throw new Error(`bun install failed in ${folder}:\n${install.stderr}`);
  }
}

/**
 * Instructions per request of each route. The server is compiled ahead of time and started once. Requests go one after the other over one connection, every answer
 * is compared, and the counter is read between two blocks of requests, while the server waits. The answer is the median block: a collection falls into one block in
 * five or ten and costs as much as hundreds of requests, so a mean would say how many collections the run happened to hold.
 * What the runtime's caches learn in the first requests differs from start to start and can cost a route 3% for as long as the process lives: the answer is the
 * least of several starts.
 */
export async function measureServer(
  bun: string,
  folder: string,
  server: string,
  { starts = 3, warmUpRounds = 300, requests = 8000, requestsInBlock = 200, buildFlags = [] as string[], routes = routesOfTheServers } = {},
): Promise<Readings> {
  const environment = { PATH: process.env.PATH, HOME: folder, TMPDIR: folder, ...steadyEnvironment };
  const executable = join(folder, `${server}-server`);
  const build = Bun.spawnSync({
    cmd: [bun, "build", "--compile", "--aot", ...buildFlags, `./${server}.ts`, "--outfile", executable],
    cwd: folder,
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (build.exitCode !== 0) throw new Error(`${server} does not build:\n${build.stderr}${build.stdout}`);

  const least: Readings = new Map();
  for (let start = 0; start < starts; start++)
    for (const [name, reading] of await measureStart(executable, folder, server, environment, { warmUpRounds, requests, requestsInBlock, routes }))
      if (reading.instructions < (least.get(name)?.instructions ?? Infinity)) least.set(name, reading);
  rmSync(executable, { force: true });
  return least;
}

async function measureStart(
  executable: string,
  folder: string,
  server: string,
  environment: Record<string, string | undefined>,
  { warmUpRounds, requests, requestsInBlock, routes }: { warmUpRounds: number; requests: number; requestsInBlock: number; routes: Route[] },
): Promise<Readings> {
  // The shell waits for a line, so that the counter is open before the server's first instruction.
  await using child = Bun.spawn({
    cmd: ["/bin/sh", "-c", 'read line; exec "$0" "$@"', ...withoutAddressRandomization, executable],
    cwd: folder,
    env: { ...environment, PORT: "0", NODE_ENV: "production" },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    timeout: 600_000,
    killSignal: "SIGKILL",
  });
  const counter = openInstructionCounter(child.pid);
  if (!counter) throw new Error("instructions cannot be counted here: see kernel.perf_event_paranoid");
  child.stdin.write("\n");
  child.stdin.end();
  let printed = "";
  let origin = "";
  for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
    printed += chunk;
    const port = /^listening (\d+)$/m.exec(printed)?.[1];
    if (port) {
      origin = `http://127.0.0.1:${port}`;
      break;
    }
  }
  if (!origin) throw new Error(`${server} exited before it listened`);

  const send = async (route: Route) => {
    const response = await fetch(origin + route.path, {
      redirect: "manual",
      method: route.method,
      body: route.request,
      headers: route.headers ?? (route.request === undefined ? {} : { "Content-Type": "application/json" }),
    });
    const body = await response.text();
    if (response.status !== (route.status ?? 200) || body !== route.expectedBody)
      throw new Error(`${server} ${route.name}: status ${response.status}, body ${JSON.stringify(body.slice(0, 200))}`);
  };
  for (let round = 0; round < warmUpRounds; round++) for (const route of routes) await send(route);

  const readings: Readings = new Map();
  for (const route of routes) {
    const blocks: number[] = [];
    for (let sent = 0; sent < requests; sent += requestsInBlock) {
      const start = counter.readNow()!;
      for (let request = 0; request < requestsInBlock; request++) await send(route);
      blocks.push((counter.readNow()! - start) / requestsInBlock);
    }
    readings.set(`server ${server} ${route.name}`, { instructions: blocks.sort((a, b) => a - b)[blocks.length >> 1] });
  }
  counter();
  child.kill("SIGKILL");
  return readings;
}

/** The rows that moved by more than `threshold` percent and two instructions, the largest rise first. */
export function compare(before: Readings, after: Readings, threshold: number): Change[] {
  const changes: Change[] = [];
  for (const [name, now] of after) {
    const then = before.get(name);
    if (!then) continue;
    const ratio = now.instructions / then.instructions;
    if (Math.abs(ratio - 1) * 100 <= threshold || Math.abs(now.instructions - then.instructions) <= 2) continue;
    const yardstickRatio = now.yardstick && then.yardstick ? now.yardstick / then.yardstick : 1;
    changes.push({
      name,
      before: then.instructions,
      after: now.instructions,
      percent: (ratio - 1) * 100,
      runtimeMovedToo: Math.abs(yardstickRatio - 1) > 0.04 && Math.abs(yardstickRatio - ratio) < 0.05,
    });
  }
  return changes.sort((a, b) => b.percent - a.percent);
}

export const writeReadings = (path: string, readings: Readings) =>
  writeFileSync(
    path,
    [...readings]
      .map(([name, { instructions, yardstick }]) => `${name}\t${instructions.toFixed(1)}\t${yardstick?.toFixed(1) ?? ""}\n`)
      .sort()
      .join(""),
  );

export const readReadings = (path: string): Readings =>
  new Map(
    readFileSync(path, "utf8")
      .split("\n")
      .filter(Boolean)
      .map(line => line.split("\t"))
      .map(([name, instructions, yardstick]) => [
        name,
        { instructions: Number(instructions), yardstick: yardstick ? Number(yardstick) : undefined },
      ]),
  );

if (import.meta.main) {
  const { values: options } = parseArgs({
    options: {
      before: { type: "string" },
      after: { type: "string" },
      threshold: { type: "string", default: "2" },
      only: { type: "string", default: "" },
      sizes: { type: "string", default: Object.keys(sizes).join(",") },
      servers: { type: "string", default: allServers.join(",") },
      modules: { type: "string" },
      jobs: { type: "string", default: String(availableParallelism()) },
      out: { type: "string" },
      "build-flag": { type: "string", multiple: true, default: [] },
    },
  });
  if (!options.before || !options.after) {
    console.error("usage: bun test/aot/perf/compare-builds.ts --before <bun or folder> --after <bun or folder>; the top of the file lists the options");
    process.exit(2);
  }
  const threshold = Number(options.threshold);
  const jobs = Number(options.jobs);
  const wantedSizes = options.sizes.split(",").filter(Boolean) as Size[];
  for (const size of wantedSizes) if (!(size in sizes)) throw new Error(`Unknown size: ${size}`);
  const servers = options.servers === "none" ? [] : options.servers.split(",").filter(Boolean);
  for (const server of servers) if (!allServers.includes(server)) throw new Error(`Unknown server: ${server}`);
  const work = mkdtempSync(join(tmpdir(), "compare-builds-"));

  async function measureAll(side: "before" | "after", only: RegExp, onlyServers: string[], round: string): Promise<Readings> {
    const source = resolve(options[side]!);
    if (statSync(source).isDirectory()) {
      const saved = [join(source, "rows.tsv"), join(source, side, "rows.tsv")].find(existsSync);
      if (!saved) throw new Error(`${source} has no rows.tsv`);
      return readReadings(saved);
    }
    const buildFlags = side === "after" ? options["build-flag"] : [];
    const readings: Readings = new Map();
    for (const size of wantedSizes) {
      console.error(`${side}: benchmarks, ${size}`);
      const folder = join(work, `${side}-${size}-${round}`);
      for (const [name, reading] of await measureBenchmarks(source, folder, size, { only, jobs, buildFlags })) readings.set(name, reading);
      rmSync(folder, { recursive: true, force: true });
    }
    if (onlyServers.length) {
      console.error(`${side}: servers`);
      const folder = join(work, `${side}-servers-${round}`);
      prepareServers(source, folder, options.modules);
      await inParallel(jobs, onlyServers, async server => {
        try {
          for (const [name, reading] of await measureServer(source, folder, server, { buildFlags })) readings.set(name, reading);
        } catch (error) {
          console.error(`FAILS server ${server}: ${(error as Error).message}`);
        }
      });
      rmSync(folder, { recursive: true, force: true });
    }
    return readings;
  }

  const only = new RegExp(options.only);
  const before = await measureAll("before", only, servers, "first");
  const after = await measureAll("after", only, servers, "first");
  if (options.out) {
    for (const [side, readings] of [["before", before], ["after", after]] as const) {
      mkdirSync(join(options.out, side), { recursive: true });
      writeReadings(join(options.out, side, "rows.tsv"), readings);
    }
  }

  // A few rows have two costs and take one or the other from run to run. Whatever moved is measured once more on both sides, and a row is reported only if
  // both readings of one side lie beyond both readings of the other by more than the threshold.
  let changes = compare(before, after, threshold);
  let unsteady: string[] = [];
  const bothAreExecutables = [options.before, options.after].every(path => !statSync(resolve(path!)).isDirectory());
  if (changes.length && bothAreExecutables) {
    const benchmarkNames = new Set(changes.filter(change => !change.name.startsWith("server ")).map(change => change.name.split(" ")[2]));
    const again = new RegExp(`^(${[...benchmarkNames].map(name => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "(?!)"})$`);
    const serversAgain = [...new Set(changes.filter(change => change.name.startsWith("server ")).map(change => change.name.split(" ")[1]))];
    console.error(`${changes.length} rows moved: measuring them again`);
    const beforeAgain = await measureAll("before", again, serversAgain, "again");
    const afterAgain = await measureAll("after", again, serversAgain, "again");
    const isConfirmed = ({ name, percent }: Change) => {
      const [first, second] = [beforeAgain.get(name), afterAgain.get(name)];
      if (!first || !second) return false;
      const was = [before.get(name)!.instructions, first.instructions];
      const is = [after.get(name)!.instructions, second.instructions];
      return percent > 0
        ? Math.min(...is) > Math.max(...was) * (1 + threshold / 100)
        : Math.max(...is) < Math.min(...was) * (1 - threshold / 100);
    };
    unsteady = changes.filter(change => !isConfirmed(change)).map(change => change.name);
    changes = changes.filter(isConfirmed);
  }
  const knownUnsteady = changes.filter(change => unsteadyBenchmarks.test(change.name));
  changes = changes.filter(change => !unsteadyBenchmarks.test(change.name));
  rmSync(work, { recursive: true, force: true });

  const print = (title: string, rows: Change[]) => {
    console.log(`\n${rows.length} ${title}`);
    for (const { name, before, after, percent } of rows)
      console.log(`  ${(percent > 0 ? "+" : "") + percent.toFixed(1)}%`.padEnd(10) + `${before.toFixed(1).padStart(12)} > ${after.toFixed(1).padStart(12)}  ${name}`);
  };
  const slower = changes.filter(change => change.percent > 0 && !change.runtimeMovedToo);
  const compared = [...after.keys()].filter(name => before.has(name)).length;
  if (!compared) {
    console.error("Nothing was compared: no benchmark matches --only, or every row failed");
    process.exit(2);
  }
  console.log(`${compared} rows compared, instructions per turn or per request, threshold ${threshold}%`);
  print("got slower", slower);
  print("got slower, and so did the same code under the JIT: look in the runtime, not in the compiler", changes.filter(change => change.percent > 0 && change.runtimeMovedToo)); // prettier-ignore
  print("got faster", changes.filter(change => change.percent < 0).reverse());
  print("moved, but are known to cost one of two amounts from run to run (`unsteadyBenchmarks`)", knownUnsteady);
  if (unsteady.length) console.log(`\n${unsteady.length} moved once and not the second time: ${unsteady.join(", ")}`);
  process.exit(slower.length ? 1 : 0);
}
