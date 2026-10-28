// A loop calls a function that hands it one of three things and asks whether what it got is a certain one, which nothing has asked for until then (fuzz/a-loop-tests-for-what-a-function-it-calls-is-the-first-to-ask-for.ts). A run takes a share of the table; the lanes at home draw from all of it.
import { flagsOf, programOf, programs } from "./fuzz/a-loop-tests-for-what-a-function-it-calls-is-the-first-to-ask-for";
import { generated } from "./generated/run-generated";

generated(
  "a loop tests for what a function it calls is the first to ask for",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 600 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
