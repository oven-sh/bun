// Makes small programs without end, runs each plain and compiled, and keeps what differs.
//
//   bun test/aot/fuzz/run.ts --seconds 3600 --jobs 16 --out /tmp/fuzz                       the Bun that runs this is the Bun under test
//   bun test/aot/fuzz/run.ts --bun <path> --engine <folder with fe, testaot, jsc> --engine-jobs 32 --jobs 8 --out <folder> ..
//   bun test/aot/fuzz/run.ts --replay mutation:1234 [--bed engine] [--print-only]           one program again, printed with its verdicts
//
//   --seconds <n>         stops after that long (default 600); a file STOP in --out stops it too
//   --programs <n>        stops after that many programs
//   --rounds              round after round of --seconds each, every one in a folder <out>/<n> of its own and from a new seed, until a file STOP lies in --out
//   --jobs <n>            builds at once on the product bed (default: a quarter of the cores; 0: none)
//   --engine-jobs <n>     programs at once on the engine bed (default 0)
//   --batch <n>           the largest number of programs in one build of the product (default 32)
//   --seed <n>            the first seed (default: from the clock). Program number i has seed + i
//   --sources a,b:8       of mutation, grammar, protocols, new-targets, object-mutations, typed-object-mutations, unsound-types (default: all). A number is a weight: b is drawn eight times as often as a
//   --flags "<flags>"     added to every build on the product bed; --engine-flags the same for the engine bed
//   --validate            also builds each program in validate mode
//   --modes a,b           only these modes of the product bed: default, validate, proofs-checked, erased, every-function-hot, and those that run only when named here:
//                         erased-and-hot, nothing-inlined, hot-and-nothing-inlined, no-flow-results, hot-without-flow-results, every-function-cold, counts-as-very-large, cold-and-very-large, erased-cold-and-very-large,
//                         erased-and-cold, allocations-leave-the-fast-path, claims-checked, moved-loads-checked, hot-with-claims-checked, hot-with-moved-loads-checked
//   --collector-stress 1,2,3,5,7,11   the executable runs with a collection at every n-th allocation that leaves the fast path, freed cells overwritten and never reused;
//                         n and whether the collections are full or young are drawn anew for every batch and stand among the flags of a finding as --in-the-run=<variable>
//                         (0 among them: no collections but the program's own); --fenced: half of the batches with every write barrier on its fenced road
//   --fail-predictions 1,2,7   one time in n compiled code takes the general road behind a test though the value would have passed; n and the seed are drawn anew for every batch
//   --lowered-limits      each batch is built with one limit of the compiler or of its run time at 0, 1 or 2 (--aot-limit), drawn anew for every batch: a small program then runs what only a large one meets
//   --company 0,17,65,300 each batch is built beside a module of so many unrelated shapes that hold the names its programs use (company.ts), the number drawn anew for every batch;
//                         it stands among the flags of a finding as --in-the-company-of=<n>
//   --beside-the-program no-tsconfig,the-bed's-own,an-empty-tsconfig,a-lib-without-dom,as-bun-init-leaves-it   what lies in the folder of a build, drawn anew for every batch (beds.ts `projects`); it stands among the flags
//                         of a finding as --beside-the-program=<name>. Give --work a folder with no tsconfig.json and no node_modules anywhere above it. Without this option: the bed's own tsconfig.json beside a typed program
//   --workers <n>         n workers run each program at once, each for itself, in place of the main thread; lines are compared in any order
//   --as-a-user           the compiler's verifiers stay off, as in a user's build: what they would refuse is built and run
//   --environment "A=1 B=2"      set for every process ("A=" takes A out); --run-environment the same for the run of the executable alone (the collector's options, say)
//   --run-seconds <n>     the time a plain run may take (default 20); --compiled-run-seconds <n> the executable's (default: the same)
//   --known <file>        findings that are counted and not kept, in the form of accepted-differences.tsv beside this file, which is always read
//                         (may be repeated)
//   --work <folder>       where programs and executables are written (default /dev/shm if it exists)
//   --min-free-gb <n>     pauses while --work or --out has less free (default 4)
//   --reduce-seconds <n>  the time one reduction may take (default 600 on the product bed, a third of it on the engine bed)
//   --count-only          lists every failure in failures.tsv and counts it in groups.tsv: nothing is confirmed, reduced or stored
//   --no-attribution      does not look for the pass or the flow result without which a finding goes away, which takes a dozen builds or more
//
// A typed program whose build stops at a type error is asked of TypeScript itself, with Bun's typings at hand (type-check.ts): what TypeScript refuses too is counted as skipped ("type error TSn, as in TypeScript"), what it accepts is a finding
// of the kind "build refused".
//
// In --out: status.txt (one line, rewritten every 20 s), groups.tsv (for the sources that name what a program is about: programs, runs and failures of each group), failures.tsv (every failure, known and repeated ones too), findings.tsv (one line per distinct finding) and findings/<name>/ with
// reduced.*, original.*, plain.txt, compiled.txt and finding.json (seed, source, bed, mode, flags, binary, what is guilty).
import { existsSync, mkdirSync, readdirSync, rmSync } from "fs";
import { availableParallelism } from "os";
import { join } from "path";
import { changeEnvironment, EngineBed, ProductBed, type Bed } from "./beds";
import { fuzz } from "./fuzzer";
import { allSources } from "./sources";

function option(name: string): string | undefined {
  const at = process.argv.indexOf("--" + name);
  return at < 0 ? undefined : (process.argv[at + 1] ?? "");
}
const options = (name: string) => process.argv.flatMap((word, at) => (word === "--" + name ? [process.argv[at + 1]] : []));
const has = (name: string) => process.argv.includes("--" + name);
const words = (text: string | undefined) => (text ?? "").split(/\s+/).filter(Boolean);
const pairs = (text: string | undefined) => Object.fromEntries(words(text).map(word => [word.slice(0, word.indexOf("=")), word.slice(word.indexOf("=") + 1)]));

const work = join(option("work") ?? (existsSync("/dev/shm") ? "/dev/shm" : (process.env.TMPDIR ?? "/tmp")), `aot-fuzz-${process.pid}`);
const programsRoot = option("programs-root") ?? join(import.meta.dir, "..", "programs");
const replay = option("replay");

changeEnvironment(pairs(option("environment")), has("as-a-user"));
const beds: { bed: Bed; jobs: number }[] = [];
const productJobs = Number(option("jobs") ?? Math.max(1, availableParallelism() >> 2));
const engineJobs = Number(option("engine-jobs") ?? 0);
if (replay ? option("bed") !== "engine" : productJobs > 0)
  beds.push({ jobs: productJobs, bed: new ProductBed(option("bun") ?? process.execPath, { baseFlags: words(option("flags")), validate: has("validate"), threads: Number(option("threads") ?? 4), buildSeconds: Number(option("build-seconds") ?? 300), runSeconds: Number(option("run-seconds") ?? 20), compiledRunSeconds: option("compiled-run-seconds") ? Number(option("compiled-run-seconds")) : undefined, runEnvironment: pairs(option("run-environment")), modes: option("modes")?.split(","), workers: Number(option("workers") ?? 0), collectorStress: option("collector-stress")?.split(",").map(Number), isFenced: has("fenced"), failPredictions: option("fail-predictions")?.split(",").map(Number), lowersLimits: has("lowered-limits"), company: option("company")?.split(",").map(Number), projects: option("beside-the-program")?.split(",") }) }); // prettier-ignore
if (option("engine") && (replay ? option("bed") === "engine" : engineJobs > 0))
  beds.push({ jobs: engineJobs, bed: new EngineBed(option("engine")!, { baseFlags: words(option("engine-flags")), validate: has("validate"), buildSeconds: 60, runSeconds: 10 }) });

for (const { bed } of beds) if (bed instanceof EngineBed) console.log("the engine bed lacks: " + (await bed.prepare(join(work, "probes"))).join(" "));

if (replay) {
  const [source, seed] = replay.split(":");
  const { bed } = beds[0];
  const generated = (await allSources(programsRoot, new Set()))[source](Number(seed), bed);
  if (!generated) throw new Error("the source gives no program for this seed");
  console.log(`// ${generated.source}:${generated.seed} ${generated.notes}\n${generated.text}`);
  if (!has("print-only")) {
    mkdirSync(work, { recursive: true });
    for (const mode of bed.modes(generated)) console.log(`// ${bed.name} ${mode.name}:`, (await bed.judge(work, [generated], mode.flags))[0].verdict);
    rmSync(work, { recursive: true, force: true });
  }
} else {
  const out = option("out") ?? join(process.cwd(), "fuzz-out");
  mkdirSync(out, { recursive: true });
  const round = () => String(1 + Math.max(0, ...readdirSync(out).map(Number).filter(Number.isInteger)));
  do {
    const summary = await fuzz({
      beds,
      out: has("rounds") ? join(out, round()) : out,
      work,
      programsRoot,
      seconds: Number(option("seconds") ?? 600),
      programs: option("programs") ? Number(option("programs")) : undefined,
      firstSeed: Number(option("seed") ?? Math.floor(Date.now() / 1000) * 1000),
      sources: option("sources")?.split(",").flatMap(word => Array<string>(Number(word.split(":")[1] ?? 1)).fill(word.split(":")[0])),
      attribute: !has("no-attribution"),
      isCountOnly: has("count-only"),
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
