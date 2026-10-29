// Each program under ./idioms runs one everyday JavaScript idiom in a loop. The test measures how many instructions one iteration takes when the
// program is compiled ahead of time, once as TypeScript and once as JavaScript, and holds both against
// ./pins.<os>-<arch>.json, which only goes down. Where a pin was once lower than it is today the file keeps that number as `best`, and the idiom is listed as a todo
// until it is back there.
//
//   bun test test/aot/perf/idioms.test.ts                   fails if a compiled form takes more than 10% AND more than 20 instructions per
//                                                           iteration more than the pin, or more than 25% AND more than 4 instructions more
//   AOT_PERF=lower bun test test/aot/perf/idioms.test.ts    writes every number that got better into the file
//   AOT_PERF=update bun test test/aot/perf/idioms.test.ts   rewrites the pinned numbers as measured, and measures plain Bun with its JIT too, for comparison: it is never judged
//   AOT_PERF_ONLY='^(spread|rest)/' ..                      only the idioms whose path matches the regular expression
//
// Instructions are counted in user mode around the whole process (perf_event_open, or /usr/bin/time -l on macOS): no clock, the same at any load. Where
// they cannot be counted everything is skipped. On a platform without pins the numbers are printed and not judged: ./pins-from-a-log.ts writes the file
// from the log of such a run. The cost of one iteration is the difference between a run of n
// iterations and a run of n / 4, divided by 3n / 4, so that start-up and warm-up cancel out. turns.json has n for each idiom.
// ./untyped-idioms.ts makes the JavaScript.
import { test } from "bun:test";
import { comesInParts, pinnedIdioms } from "./pinned-idioms";

if (comesInParts) test.skip("aot/perf/idioms-in-parts has them", () => {});
else pinnedIdioms();
