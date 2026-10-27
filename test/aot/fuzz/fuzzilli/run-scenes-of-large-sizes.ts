// Builds each kind of scene of write-scenes-of-every-size.ts at larger and larger sizes, one program to a build, and says how the time of the build grows.
//
//   bun run-scenes-of-large-sizes.ts --bun <the Bun that builds and runs> --work <folder> --finds <folder> [--sizes 256,1024,4096,16384,65536] [--seconds 600] [--share 0/1] [--rounds 1] [--flags=--aot-threads=2]
//
// A kind climbs the sizes until a build is refused, stops, or doesn't end in `--seconds`. All times are seconds of processor time, which don't depend on what else the machine does. One line for each build. `--rounds 0` never ends, and each round draws other scenes, one past each size in every second round.
// `--share 3/24` takes every 24th pair of a kind and an extension, from the third on, so that 24 processes share the work.
// What is kept under `--finds`, each with the program and a report:
//   not-ended      the build didn't end in time
//   build-stopped  the compiler stopped by a signal or with an internal error
//   grows          the build took 20 seconds or more, and more than its share: four times the size, more than nine times the time
//   differs        the executable prints something else than `bun run`, or ends in another way
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { withoutInstallingPackages } from "../../harness/without-installing-packages";
import { kindsOfScenes, writeOneSceneOfEverySize } from "./write-scenes-of-every-size.ts";

const { values: options } = parseArgs({
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    sizes: { type: "string", default: "256,1024,4096,16384,65536" },
    seconds: { type: "string", default: "600" },
    share: { type: "string", default: "0/1" },
    rounds: { type: "string", default: "1" },
    flags: { type: "string", default: "--aot-threads=2" },
    kinds: { type: "string", default: "" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
if (!work || !finds) throw new Error("Expected --work and --finds");
const [mine, shares] = options.share.split("/").map(Number);
const [seconds, rounds] = [Number(options.seconds), Number(options.rounds)];
const flags = options.flags.split(" ").filter(Boolean);
const kinds = options.kinds ? options.kinds.split(",") : kindsOfScenes;
const pairs = kinds
  .flatMap(kind => ["ts", "js"].map(extension => ({ kind, extension })))
  .filter((_, index) => index % shares === mine);

async function spawn(cmd: string[], cwd: string, bound: number) {
  const started = performance.now();
  const [stdout, stderr] = [join(cwd, "stdout"), join(cwd, "stderr")];
  // A child writes over the start of a file that exists and leaves the rest.
  for (const path of [stdout, stderr]) rmSync(path, { force: true });
  const child = Bun.spawn({
    cmd: ["sh", "-c", `ulimit -t ${bound}; exec "$0" "$@"`, ...cmd],
    cwd,
    env: { ...process.env, NO_COLOR: "1" },
    stdin: "ignore",
    stdout: Bun.file(stdout),
    stderr: Bun.file(stderr),
    timeout: bound * 8000,
    killSignal: "SIGKILL",
  });
  const exitCode = await child.exited;
  const usage = child.resourceUsage()!;
  const took = Number(usage.cpuTime.total) / 1e6;
  return {
    // Behind eight times as many seconds by the clock the machine is too full to tell.
    end:
      took >= bound - 1
        ? "not ended"
        : (performance.now() - started) / 1000 >= bound * 8
          ? "no processor"
          : (child.signalCode ?? String(exitCode)),
    took,
    megabytes: usage.maxRSS / 2 ** 20,
    stdout: readFileSync(stdout, "latin1"),
    stderr: readFileSync(stderr, "latin1"),
  };
}

/** The largest value of each counter of the compiler in the builds so far, as run-batch.ts keeps it. */
const largestSeen = new Map<string, number>();

function keep(what: string, name: string, extension: string, text: string, report: string) {
  const folder = join(finds, `${what}-${name}`);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "program." + extension), text, "latin1");
  writeFileSync(join(folder, "report.txt"), report);
}

for (let round = 0; rounds === 0 || round < rounds; round++) {
  for (const { kind, extension } of pairs) {
    let before: { size: number; took: number } | undefined;
    const seed = `${round}.${Math.random().toString(36).slice(2, 8)}`;
    for (const size of options.sizes.split(",").map(size => Number(size) + (round % 2))) {
      const folder = join(work, `large-${process.pid}`);
      rmSync(folder, { recursive: true, force: true });
      withoutInstallingPackages(folder);
      const text = writeOneSceneOfEverySize(kind, seed, extension === "ts", size);
      const [program, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
      writeFileSync(join(folder, "program." + extension), program, "latin1");
      for (let other = 0; other < others.length; other += 2) {
        mkdirSync(dirname(join(folder, others[other])), { recursive: true });
        writeFileSync(join(folder, others[other]), others[other + 1], "latin1");
      }
      const command = [bun, "build", "--compile", "--aot", ...flags, "./program." + extension, "--outfile", "program"];
      const built = await spawn([...command, "--aot-report", "report.json"], folder, seconds);
      try {
        const { statistics } = JSON.parse(readFileSync(join(folder, "report.json"), "utf8"));
        for (const [counter, value] of Object.entries<number>(statistics))
          if (value > (largestSeen.get(counter) ?? 0)) largestSeen.set(counter, value);
        mkdirSync(finds, { recursive: true });
        writeFileSync(join(finds, `counters-${process.pid}.json`), JSON.stringify(Object.fromEntries(largestSeen)));
      } catch {}
      const name = `${kind}-${extension}-${size}`;
      const head = `${kind} .${extension} size ${size}, seed ${seed}, ${text.length} bytes\n${command.join(" ")}\n`;
      const grew = before ? built.took / before.took : 0;
      let said = `build ${built.took.toFixed(1)} s ${built.megabytes.toFixed(0)} MB ends with ${built.end}`;
      if (before) said += `, ${grew.toFixed(1)} times the time of size ${before.size}`;
      const stop = /internal compiler error.*$|Stopped while compiling.*$/m.exec(built.stderr)?.[0];
      let climbs = built.end === "0";
      if (built.end === "not ended") keep("not-ended", name, extension, text, `${head}${said}\n`);
      // Whoever stops the processes of a lane ends the build too.
      else if (built.end === "no processor" || built.end === "SIGTERM") said += "";
      else if (stop !== undefined || !/^\d+$/.test(built.end))
        keep("build-stopped", name, extension, text, `${head}${said}\n${stop ?? ""}\n${built.stderr.slice(-4000)}`);
      else if (built.end !== "0") said += ` | ${/^error.*$/m.exec(built.stderr)?.[0].slice(0, 120) ?? ""}`;
      else {
        if (before && built.took >= 20 && grew > (size / before.size) ** 1.6)
          keep("grows", name, extension, text, `${head}${said}\n`);
        const compiled = await spawn([join(folder, "program")], folder, 120);
        const plain = await spawn([bun, "run", "./program." + extension], folder, 120);
        // `bun run` gives up on some texts that the compiler takes.
        const givesUp =
          plain.end !== "0" &&
          compiled.end === "0" &&
          /RangeError: (?:Out of memory|Maximum call stack)/.test(plain.stderr);
        const isSame = givesUp || (compiled.end === plain.end && compiled.stdout === plain.stdout);
        said += ` | run ${compiled.took.toFixed(1)} s ends with ${compiled.end}, bun run ${plain.took.toFixed(1)} s ends with ${plain.end}: ${givesUp ? "bun run gives up" : isSame ? "same" : "DIFFERS"}`;
        if (
          !isSame &&
          ![plain.end, compiled.end].some(end => end === "no processor" || end === "SIGTERM") &&
          plain.end !== "not ended"
        )
          keep(
            "differs",
            name,
            extension,
            text,
            `${head}${said}\ncompiled:\n${compiled.stdout.slice(0, 2000)}\n${compiled.stderr.slice(-2000)}\nbun run:\n${plain.stdout.slice(0, 2000)}\n${plain.stderr.slice(-2000)}`,
          );
      }
      console.log(`${new Date().toISOString().slice(11, 19)} ${name}: ${said}`);
      rmSync(folder, { recursive: true, force: true });
      if (!climbs) break;
      before = { size, took: built.took };
    }
  }
}
