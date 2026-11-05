// Draws programs and builds each one as a user builds it: `bun build --compile --aot <file>`, the program is the entry point and nothing else is in the executable. The executable runs as a process of its own
// and is held against `bun <file>`: what it prints, and how it ends. A difference that the executable of `bun build --compile` without --aot shows as well is counted and not kept.
//
// run-batch.ts puts a runner, Workers and other programs into the executable. What a build proves only of a program that is its own entry point, and what it leaves out because nothing else reaches it,
// it never shows there: of 31 known faulty programs run-batch.ts saw 12, each built by itself beside the runner. This driver costs a build for each program.
//
//   bun run-alone.ts --bun <the Bun that builds and runs> --work <folder> --finds <folder> [--draws ts|js] [--scene <name>,<name>] [--families 25] [--programs <folder>] [--seconds 3600]
//
// `--scene a,b` draws every program from those scenes of write-ordinary-scenes.ts, one scene to a program. Without it a program has one to three scenes of any kind.
// `--families 25` draws 25 programs of 100 from the sources of ../sources.ts that give one file.
// `--programs <folder>` takes the files of the folder, once each, in place of draws.
// `--checks-proofs 50` builds 50 programs of 100 once more with --aot-testing=CheckProofsAtRunTime, `--writes-straight 50` with --aot-testing=WritesBodiesStraight. Both executables have to do as `bun <file>` does.
// `--as-a-test 25` has a test import 25 programs of 100, under `bun test --aot` and under `bun test`. A difference counts where the compiled test run prints something else than the executable too.
// What it keeps under --finds is laid out as run-batch.ts lays it out: <kind>-<hash of the words>/<size as a power of two>/{program.<extension>, report.txt, compiled.stdout, ..}, and index.txt.
// It prints a line with {"taken": n, ..} every 50 programs, as run-batch.ts does for each batch.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { parseArgs } from "node:util";
import { writeOrdinaryScenes } from "./write-ordinary-scenes.ts";

const { values: options } = parseArgs({
  // lane.ts hands every driver what run-batch.ts takes.
  strict: false,
  allowPositionals: true,
  options: {
    bun: { type: "string", default: process.execPath },
    work: { type: "string" },
    finds: { type: "string" },
    draws: { type: "string", default: "ts" },
    scene: { type: "string", default: "" },
    families: { type: "string", default: "0" },
    programs: { type: "string", default: "" },
    seconds: { type: "string", default: "0" },
    flags: { type: "string", default: "--aot-threads=1" },
    "checks-proofs": { type: "string", default: "0" },
    "writes-straight": { type: "string", default: "0" },
    "as-a-test": { type: "string", default: "0" },
  },
});
const { bun, work, finds } = options as Record<string, string>;
for (const name of [
  "draws",
  "scene",
  "families",
  "programs",
  "seconds",
  "flags",
  "checks-proofs",
  "writes-straight",
  "as-a-test",
])
  options[name] = String(options[name]);
if (!work || !finds) throw new Error("Expected --work and --finds");
const flags = options.flags.split(" ").filter(Boolean);
const folder = join(work, `alone-${process.pid}`);
mkdirSync(finds, { recursive: true });

type Ended = { stdout: string; stderr: string; end: string };
async function spawn(cmd: string[], seconds: number): Promise<Ended> {
  const child = Bun.spawn({
    cmd,
    cwd: folder,
    env: { ...process.env, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0", NO_COLOR: "1" },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: seconds * 1000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return {
    stdout: stdout.slice(0, 1 << 20),
    stderr: stderr.slice(-8000),
    end: child.signalCode === "SIGKILL" ? "time" : (child.signalCode ?? String(exitCode)),
  };
}

/** `console.log(error)` prints lines of the source, a message whose words can differ, and a stack. As in run-batch.ts. */
const withoutDetails = (output: string) =>
  output
    .replace(/[ \t]*\d+ \| .*\n(?:\s*\d+ \| .*\n|[\^~ ]+\n)*/g, " ")
    .split("\n")
    .filter(line => !/^\s*(\d+ \| |[\^~ ]+$|at |(originalLine|originalColumn|sourceURL|stack): )/.test(line))
    .map(line => line.replace(/Error: .*/, "Error").replace(/\[(\w*Function): [^\]]*\]/g, "[$1]"))
    .join("\n");
const agree = (a: Ended, b: Ended) => a.end === b.end && withoutDetails(a.stdout) === withoutDetails(b.stdout);
/** The two runs differ in where the lines of a function's text break and in parentheses that change nothing. As in run-batch.ts. */
const withoutLayout = (output: string) => withoutDetails(output).replace(/\\n|[\s()]/g, "");
/** What docs/compiler/compatibility.mdx lists, by what the executable says or the program names. */
const isDocumented = (text: string, ours: Ended) =>
  [
    "read-only in a compiled executable",
    "Attempted to assign to readonly property",
    "this executable was compiled assuming",
    "Maximum call stack size exceeded",
  ].some(message => ours.stderr.includes(message) || ours.stdout.includes(message)) ||
  ["WeakRef", "FinalizationRegistry", "import.meta", "__filename", "__dirname", ".argv", ".stack", ".caller"].some(
    name => text.includes(name),
  );
const stopAtAFalseProof = /^AOT: .*$/m;

/** `plain` and `plainAgain` are two runs of the reference, `ours` is the second run of what was compiled. */
function kindOfDifference(text: string, plain: Ended, plainAgain: Ended, ours: Ended) {
  if (!agree(plain, plainAgain)) return "the reference is unsteady";
  if (agree(ours, plainAgain)) return "unsteady";
  if (ours.end === "time") return "limit";
  if (stopAtAFalseProof.test(ours.stderr)) return "false-proof";
  // No page declares a death.
  if (/^SIG/.test(ours.end) || Number(ours.end) >= 128) return "signal";
  if (ours.end === plainAgain.end && withoutLayout(ours.stdout) === withoutLayout(plainAgain.stdout))
    return "function text";
  if (isDocumented(text, ours)) return "documented difference";
  return ours.end !== plainAgain.end ? "exit-code" : "stdout";
}
const kept = ["false-proof", "signal", "exit-code", "stdout", "limit"];
function firstDifference(ours: Ended, plain: Ended) {
  const [left, right] = [withoutDetails(ours.stdout).split("\n"), withoutDetails(plain.stdout).split("\n")];
  const line = left.findIndex((each, at) => each !== right[at]);
  const said = stopAtAFalseProof.exec(ours.stderr)?.[0];
  return `compiled: ${ours.end}${said ? " | " + said : ""}\nbun run:  ${plain.end}\ncompiled: ${(left[line] ?? "").slice(0, 400)}\nbun run:  ${(right[line] ?? "").slice(0, 400)}\n`;
}

function keepFind(kind: string, summary: string, files: Record<string, string>) {
  const group = `${kind}-${Bun.hash
    .crc32(summary.replace(/[0-9a-f]/gi, ""))
    .toString(16)
    .padStart(8, "0")}`;
  const name = `${group}/${Math.floor(Math.log2(Math.max(1, Object.values(files)[0].length)))}`;
  if (existsSync(join(finds, name))) return;
  mkdirSync(join(finds, name), { recursive: true });
  for (const [file, text] of Object.entries(files)) writeFileSync(join(finds, name, file), text.slice(0, 256 << 10));
  appendFileSync(join(finds, "index.txt"), name + "\n");
}

type Family = (
  seed: number,
  bed: unknown,
) => { text: string; extension: string; flags?: string[]; files?: unknown } | undefined;
let families: [string, Family][] = [];
if (Number(options.families) > 0) {
  const { allSources } = await import("../sources.ts");
  families = Object.entries(await allSources(join(import.meta.dir, "..", "..", "parallel"), new Set())) as [
    string,
    Family,
  ][];
}
const bed = { name: "product", binary: "", accepts: () => true, allows: () => true, batch: 1 };
const scenes = options.scene.split(",").filter(Boolean);
const given = options.programs
  ? readdirSync(options.programs)
      .filter(name => /\.[cm]?[jt]s$/.test(name))
      .sort()
  : undefined;

function draw(): { text: string; extension: string } | undefined {
  if (given) {
    const name = given.shift();
    return name === undefined
      ? undefined
      : { text: readFileSync(join(options.programs, name), "utf8"), extension: extname(name) };
  }
  const seed = Math.floor(Math.random() * 2 ** 48);
  while (Math.random() * 100 < Number(options.families)) {
    const [name, family] = families[Math.floor(Math.random() * families.length)];
    try {
      const drawn = family(seed % 2 ** 31, bed);
      if (drawn && !drawn.flags?.length && !drawn.files && drawn.extension.endsWith(options.draws))
        return { text: `${drawn.text}\n// ${name} ${seed % 2 ** 31}\n`, extension: "." + drawn.extension };
    } catch {}
  }
  const start = `const printValue = console.log;\n// ${seed.toString(36)}\nexport {};\n`;
  const text = writeOrdinaryScenes(
    start,
    options.draws === "ts",
    scenes.length ? scenes[seed % scenes.length] : undefined,
    scenes.length ? 1 : undefined,
  );
  // A text that needs nothing of a module is a CommonJS file now and then, and always where it says that it stays a script.
  const script = text.replace(/^export \{\};\n/gm, "");
  const canBeAScript = !/^\s*(?:import|export)\b|\bawait\b|^\/\/ @filename: /m.test(script);
  if (canBeAScript && (script.includes("// stays a script") || Math.random() < 0.25))
    return { text: script, extension: options.draws === "ts" ? ".cts" : ".cjs" };
  return script.includes("// stays a script") ? draw() : { text, extension: "." + options.draws };
}

const counts: Record<string, number> = { taken: 0 };
const add = (kind: string) => (counts[kind] = (counts[kind] ?? 0) + 1);
const lastStart = Number(options.seconds) ? performance.now() + Number(options.seconds) * 1000 : Infinity;
let started = performance.now();
while (performance.now() < lastStart) {
  const program = draw();
  if (!program) break;
  const { text, extension } = program;
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const [main, ...others] = text.split(/^\/\/ @filename: \.\/(\S+)\n/m);
  writeFileSync(join(folder, "program" + extension), main);
  for (let other = 0; other < others.length; other += 2) {
    mkdirSync(dirname(join(folder, others[other])), { recursive: true });
    writeFileSync(join(folder, others[other]), others[other + 1]);
  }
  counts.taken++;
  const plain = await spawn([bun, "program" + extension], 20);
  const arms: [string, string[]][] = [["", []]];
  let asBuilt: Ended | undefined;
  if (Math.random() * 100 < Number(options["checks-proofs"]))
    arms.push(["proof-checks-", ["--aot-testing=CheckProofsAtRunTime"]]);
  if (Math.random() * 100 < Number(options["writes-straight"]))
    arms.push(["straight-", ["--aot-testing=WritesBodiesStraight"]]);
  if (plain.end === "time") add("bun <file> does not end in time");
  else
    for (const [arm, more] of arms) {
      const command = [
        bun,
        "build",
        "--compile",
        "--aot",
        ...flags,
        ...more,
        "./program" + extension,
        "--outfile",
        join(folder, "executable"),
      ];
      const built = await spawn(command, 300);
      const report = (kind: string, words: string) =>
        `${kind}, the program built alone as its own entry point\n${command.join(" ")}\n${words}`;
      if (!existsSync(join(folder, "executable"))) {
        const stop = /internal compiler error.*$|Stopped while compiling.*$|^panic.*$|^AOT: .*$/m.exec(
          built.stderr + built.stdout,
        )?.[0];
        if (stop === undefined && built.end === "1") {
          add(`${arm}refused`);
          break;
        }
        add(`${arm}build-stopped`);
        const words = `${built.end}: ${(stop ?? "").replace(/'[^'\n]*'|\bat \S+|\bfunction \S+/g, "")}`;
        keepFind(`${arm}build-stopped`, words, {
          ["program" + extension]: text,
          "report.txt": report("build-stopped", `${built.end}: ${stop ?? ""}\n`),
          "compiler.stderr": built.stderr,
        });
        continue;
      }
      let ours = await spawn([join(folder, "executable")], 40);
      if (arm === "") asBuilt = ours;
      if (agree(ours, plain)) {
        add(`${arm}same`);
        rmSync(join(folder, "executable"), { force: true });
        continue;
      }
      // A difference counts when a second pair of runs shows it again.
      const [plainAgain, oursAgain] = [
        await spawn([bun, "program" + extension], 40),
        await spawn([join(folder, "executable")], 80),
      ];
      rmSync(join(folder, "executable"), { force: true });
      const kind = kindOfDifference(text, plain, plainAgain, oursAgain);
      ours = oursAgain;
      // Where `bun build --compile` without --aot parts from `bun <file>` too, and in the same way, the bundler and the runner read something differently: a tsconfig.json in a folder, the path of the file.
      if (kind === "stdout" || kind === "exit-code") {
        await spawn(
          [bun, "build", "--compile", "./program" + extension, "--outfile", join(folder, "plain-executable")],
          300,
        );
        const bundled = existsSync(join(folder, "plain-executable"))
          ? await spawn([join(folder, "plain-executable")], 40)
          : undefined;
        rmSync(join(folder, "plain-executable"), { force: true });
        if (bundled && agree(bundled, ours)) {
          add(arm + "as the executable without --aot");
          continue;
        }
        // In which order files are loaded differs between `bun <file>` and the executable without --aot, and from run to run. It counts where those two agree and `bun <file>` says the same twenty times.
        if (others.length && /\bimport\(|\brequire\(/.test(text)) {
          if (!bundled || !agree(bundled, plainAgain)) {
            add(arm + "an order of loads on which bun <file> and the executable without --aot part");
            continue;
          }
          let holds = true;
          for (let again = 0; holds && again < 18; again++)
            holds = agree(await spawn([bun, "program" + extension], 40), plainAgain);
          if (!holds) {
            add(arm + "an order of loads in which bun <file> wavers");
            continue;
          }
        }
      }
      add(arm + kind);
      if (!kept.includes(kind)) continue;
      const summary = firstDifference(ours, plainAgain);
      keepFind(arm + kind, summary, {
        ["program" + extension]: text,
        "report.txt": report(arm + kind, summary),
        "compiled.stdout": ours.stdout,
        "compiled.stderr": ours.stderr,
        "bun-run.stdout": plainAgain.stdout,
        "bun-run.stderr": plainAgain.stderr,
      });
    }
  if (asBuilt && Math.random() * 100 < Number(options["as-a-test"])) {
    writeFileSync(
      join(folder, "wrapped.test.js"),
      `import { test } from "bun:test";\ntest("the program", async () => {\n  await import("./program${extension}");\n});\n`,
    );
    const command = [bun, "test", "--aot", "./wrapped.test.js"];
    const both = async () => [await spawn([bun, "test", "./wrapped.test.js"], 60), await spawn(command, 300)];
    const [reference, first] = await both();
    if (reference.end === "time") add("bun test does not end in time");
    else if (agree(first, reference)) add("test-run-same");
    else {
      const [referenceAgain, ours] = await both();
      let kind = kindOfDifference(text, reference, referenceAgain, ours);
      // `import()` calls run and settle in a compiled test run as they do in the executable: the page says so.
      if (
        (kind === "stdout" || kind === "exit-code") &&
        withoutDetails(ours.stdout.replace(/^bun test v.*\n/, "")) === withoutDetails(asBuilt.stdout)
      )
        kind = "as the executable";
      add("test-run-" + kind);
      if (kept.includes(kind)) {
        const summary = firstDifference(ours, referenceAgain);
        keepFind("test-run-" + kind, summary, {
          ["program" + extension]: text,
          "report.txt": `test-run-${kind}: a test imports the program\n${command.join(" ")}\n${summary}`,
          "compiled.stdout": ours.stdout,
          "compiled.stderr": ours.stderr,
          "bun-run.stdout": referenceAgain.stdout,
          "bun-run.stderr": referenceAgain.stderr,
          "executable.stdout": asBuilt.stdout,
        });
      }
    }
  }
  if (counts.taken % 50 === 0 || given?.length === 0) {
    console.log(
      `${new Date().toISOString().slice(11, 19)} ${(50 / ((performance.now() - started) / 1000)).toFixed(1)} programs a second | ${JSON.stringify(counts)}`,
    );
    for (const kind in counts) counts[kind] = 0;
    started = performance.now();
  }
}
rmSync(folder, { recursive: true, force: true });
