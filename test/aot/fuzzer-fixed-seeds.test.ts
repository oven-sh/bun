// A small, fixed part of what test/aot/fuzz/run.ts does without end: programs from the grammar, from the protocols and from mutated
// test programs, each run compiled (with the default flags, validated, and with its types erased) and in plain Bun.
//
//   bun test test/aot/fuzzer-fixed-seeds                                     45 programs from seed 1
//   AOT_FUZZ_PROGRAMS=2000 AOT_FUZZ_SEED=7 bun test test/aot/fuzzer-fixed-seeds
//   AOT_FRESH_SEEDS=1 bun test test/aot/fuzzer-fixed-seeds                   and as many from a seed that no run has used
//
// fuzzer-fixed-seeds-in-several-files.test.ts draws a third as many more, each in several files.
//
// Every difference that fuzz/accepted-differences.tsv does not explain fails the test. The failure lists the findings, neither
// reduced nor attributed, so that the test stays short; `bun test/aot/fuzz/run.ts --replay <source>:<seed>` shows one program again.
import { printTheSame } from "./fuzzer-fixed-seeds";

printTheSame(1, "");
