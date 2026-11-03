// Generates small programs forever, runs each one with plain Bun and as a compiled executable, and keeps the ones that
// differ.
//
//   bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --out /tmp/fuzz                    the Bun that runs this script is the Bun under test
//   bun test/aot/fuzz/run.ts --bun <path> --engine <folder with fe, testaot, jsc> --engine-jobs 32 --jobs 8 --out <folder>
//   bun test/aot/fuzz/run.ts --replay mutation:1234 [--runner engine] [--print-only]     generate one program again and print it with its verdicts
//
// How long, how wide
//   --seconds <n>         stop after n seconds (default 600). A file named STOP in --out also stops the run
//   --minutes <n>         the same in minutes
//   --programs <n>        stop after n programs
//   --rounds              repeat rounds of --seconds, each in its own folder <out>/<n> with a new seed, until <out>/STOP exists
//   --jobs <n>            concurrent builds on the product runner (default: a quarter of the cores; 0: none)
//   --engine-jobs <n>     concurrent programs on the engine runner (default 0)
//   --batch <n>           maximum number of programs in one product build (default 32)
//   --threads <n>         compiler threads per build (default 4)
//   --seed <n>            first seed (default: from the clock). Program i has seed + i
//   --bun <path>         the Bun under test (default: the one that runs this script); --out <folder>: where results go (default ./fuzz-out)
//   --reference <path>   the Bun that makes the plain runs (default: the one under test). An older release also shows a fault in code that plain
//                        and compiled runs share
//
// What is generated
//   --sources a,b:8       only these sources (default: all). A number is a weight: b is used eight times as often as a
//   --programs-root <folder>   the stored programs that `mutation` and the `stored-programs` sources use (default ../parallel)
//   --single-file         by default every second program is also generated as <source>-multi-file: its top-level declarations move into up to four
//                         more files that import each other. --sources and --replay accept that name too. A finding in such a program is first tried
//                         as a single file; if it needs the files, the reducer removes files first, then lines
//   --rewritten           also generate each source as <source>-rewritten: the program is transformed in one to seven ways that keep its output and hide
//                         information from the compiler (values laundered through eval, loop bounds known only at run time, a GC inside calls, functions
//                         the host could call, open-world global access, the whole file wrapped in a function, a try or a loop)
//
// How it is built and run
//   --flags "<flags>"     added to every product build; --engine-flags is the same for the engine runner
//   --modes a,b           only these build modes. Always on: default, check-proofs, erased, hot, separate-entry-points (and validate with --validate).
//                         Only when named: erased-hot, hot-check-proofs, no-inlining, hot-no-inlining, no-flow-results, hot-no-flow-results, cold, large,
//                         cold-large, erased-cold-large, erased-cold, slow-path-allocations, check-claims, check-moved-loads, hot-check-claims,
//                         hot-check-moved-loads, check-decided-comparisons, hot-check-decided-comparisons
//   --validate            also build each program with --aot-validate
//   --run-once            do not run each executable a second time with the run-time checks on (BUN_JSC_validateAOTRuntime=1)
//   --no-verifiers        leave the compiler's verifiers off, as in a user's build
//   --gc-stress 1,2,3,5,7,11   run the executable with a collection at every n-th slow-path allocation, with freed cells scribbled and never reused. n, and
//                         whether collections are full or eden, are picked per batch and recorded in the finding's flags as --run-env=<variable>.
//                         0 means no extra collections. --fenced: half of the batches use the fenced write barrier
//   --fail-predictions 1,2,7   one time in n, compiled code takes the slow path after a type check that would have passed. n and the seed are picked per batch
//   --lowered-limits      build each batch with one compiler or run-time limit at 0, 1 or 2 (--aot-limit), so a small program hits what only a large one does
//   --decoy-shapes 0,17,65,300   build each batch beside a module with that many unrelated object shapes that use the programs' property names
//                         (decoy-shapes.ts). Recorded in the finding's flags as --decoy-shapes=<n>
//   --project no-tsconfig,default,empty-tsconfig,lib-without-dom,bun-init   which project files lie in the build folder (`projects` in runners.ts), picked per
//                         batch and recorded as --project=<name>. --work must then have no tsconfig.json and no node_modules in any parent folder
//   --workers <n>         n workers run each program concurrently instead of the main thread; output lines are compared in any order
//   --environment "A=1 B=2"   set for every process ("A=" unsets A); --run-environment applies only to the executable (GC options, for example)
//   --run-seconds <n>     time limit of a plain run (default 20); --compiled-run-seconds <n> is the executable's (default: the same)
//   --build-seconds <n>   time limit of a build (default 300)
//
// What is kept
//   --known <file>        more accepted differences, in the format of accepted-differences.tsv, which is always read. May be repeated
//   --reduce-seconds <n>  time limit of one reduction (default 600 on the product runner, a third of that on the engine runner)
//   --count-only          only list failures in failures.tsv and count them in groups.tsv: nothing is confirmed, reduced or stored
//   --no-attribution      do not search for the pass or flow result that causes a finding, which takes a dozen builds or more
//   --work <folder>       where programs and executables are written (default /dev/shm if it exists)
//   --min-free-gb <n>     pause while --work or --out has less free space (default 4)
//
// When the build of a typed program stops at a type error, TypeScript itself checks the program with Bun's typings
// (type-check.ts). If TypeScript rejects it too, the program is skipped ("type error TSn, as in TypeScript"); if
// TypeScript accepts it, that is a finding of the kind "build refused".
//
// In --out:
//   status.txt            one line, rewritten every 20 s
//   groups.tsv            programs, runs and failures per group, for sources that group their programs
//   failures.tsv          every failure, including known and repeated ones
//   findings.tsv          one line per distinct finding
//   same-without-aot.tsv  differences from `bun <file>` that an executable built without --aot shows too: not findings
//   findings/<name>/      reduced.*, original.*, plain.txt, compiled.txt and finding.json (seed, source, runner, mode, flags, binary, cause).
//                         A multi-file program is a folder reduced/ or original/ whose entry point is main.*
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { availableParallelism } from "os";
import { join } from "path";
import { withoutInstallingPackages } from "../harness/without-installing-packages";
import { changeEnvironment, EngineRunner, ProductRunner, type Runner } from "./runners";
import { fuzz } from "./fuzzer";
import { allSources } from "./sources";

function option(name: string): string | undefined {
  const at = process.argv.indexOf("--" + name);
  return at < 0 ? undefined : (process.argv[at + 1] ?? "");
}
const options = (name: string) =>
  process.argv.flatMap((word, at) => (word === "--" + name ? [process.argv[at + 1]] : []));
const has = (name: string) => process.argv.includes("--" + name);
const words = (text: string | undefined) => (text ?? "").split(/\s+/).filter(Boolean);
const pairs = (text: string | undefined) =>
  Object.fromEntries(words(text).map(word => [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)]));

const work = join(
  option("work") ?? (existsSync("/dev/shm") ? "/dev/shm" : (process.env.TMPDIR ?? "/tmp")),
  `aot-fuzz-${process.pid}`,
);
const programsRoot = option("programs-root") ?? join(import.meta.dir, "..", "parallel");
const replay = option("replay");

changeEnvironment(pairs(option("environment")), has("no-verifiers"));
const runners: { runner: Runner; jobs: number }[] = [];
const productJobs = Number(option("jobs") ?? Math.max(1, availableParallelism() >> 2));
const engineJobs = Number(option("engine-jobs") ?? 0);
if (replay ? option("runner") !== "engine" : productJobs > 0)
  runners.push({ jobs: productJobs, runner: new ProductRunner(option("bun") ?? process.execPath, { baseFlags: words(option("flags")), reference: option("reference"), noVerifiers: has("no-verifiers"), validate: has("validate"), runsOnce: has("run-once"), threads: Number(option("threads") ?? 4), buildSeconds: Number(option("build-seconds") ?? 300), runSeconds: Number(option("run-seconds") ?? 20), compiledRunSeconds: option("compiled-run-seconds") ? Number(option("compiled-run-seconds")) : undefined, runEnvironment: pairs(option("run-environment")), modes: option("modes")?.split(","), workers: Number(option("workers") ?? 0), collectorStress: option("gc-stress")?.split(",").map(Number), isFenced: has("fenced"), failPredictions: option("fail-predictions")?.split(",").map(Number), lowersLimits: has("lowered-limits"), decoyShapes: option("decoy-shapes")?.split(",").map(Number), projects: option("project")?.split(",") }) }); // prettier-ignore
if (option("engine") && (replay ? option("runner") === "engine" : engineJobs > 0))
  runners.push({
    jobs: engineJobs,
    runner: new EngineRunner(option("engine")!, {
      baseFlags: words(option("engine-flags")),
      validate: has("validate"),
      buildSeconds: 60,
      runSeconds: 10,
    }),
  });

for (const { runner } of runners)
  if (runner instanceof EngineRunner)
    console.log("the engine runner lacks: " + (await runner.prepare(join(work, "probes"))).join(" "));

if (replay) {
  const [source, seed] = replay.split(":");
  const { runner } = runners[0];
  const generated = (await allSources(programsRoot, new Set(), true))[source](Number(seed), runner);
  if (!generated) throw new Error("the source gives no program for this seed");
  console.log(`// ${generated.source}:${generated.seed} ${generated.notes}\n${generated.text}`);
  for (const [path, text] of Object.entries(generated.files ?? {})) console.log(`// ${path}\n${text}`);
  if (!has("print-only")) {
    withoutInstallingPackages(work);
    for (const mode of runner.modes(generated))
      console.log(`// ${runner.name} ${mode.name}:`, (await runner.judge(work, [generated], mode.flags))[0].verdict);
    rmSync(work, { recursive: true, force: true });
  }
} else {
  const out = option("out") ?? join(process.cwd(), "fuzz-out");
  mkdirSync(out, { recursive: true });
  const round = () => String(1 + Math.max(0, ...readdirSync(out).map(Number).filter(Number.isInteger)));
  do {
    const summary = await fuzz({
      runners,
      out: has("rounds") ? join(out, round()) : out,
      work,
      programsRoot,
      seconds: option("minutes") ? Number(option("minutes")) * 60 : Number(option("seconds") ?? 600),
      programs: option("programs") ? Number(option("programs")) : undefined,
      firstSeed: Number(option("seed") ?? Math.floor(Date.now() / 1000) * 1000),
      sources: option("sources")
        ?.split(",")
        .flatMap(word => Array<string>(Number(word.split(":")[1] ?? 1)).fill(word.split(":")[0])),
      attribute: !has("no-attribution"),
      isCountOnly: has("count-only"),
      alsoMultiFile: !has("single-file"),
      alsoRewritten: has("rewritten"),
      known: [join(import.meta.dir, "accepted-differences.tsv"), ...options("known")],
      minFreeBytes: Number(option("min-free-gb") ?? 4) * 2 ** 30,
      reduceSeconds: Number(option("reduce-seconds") ?? 600),
      batch: option("batch") ? Number(option("batch")) : undefined,
    });
    console.log(summary.status);
  } while (has("rounds") && !existsSync(join(out, "STOP")));
  // A source may leave something behind that keeps the process alive.
  process.exit(0);
}
