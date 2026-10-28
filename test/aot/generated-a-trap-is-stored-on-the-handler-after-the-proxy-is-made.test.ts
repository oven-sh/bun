// A trap is stored on the handler after the proxy is made, and taken away again; the same is asked through the proxy three times (fuzz/a-trap-is-stored-on-the-handler-after-the-proxy-is-made.ts), one case to a program. A run takes a share of the programs.
import { flagsOf, programOf, programs } from "./fuzz/a-trap-is-stored-on-the-handler-after-the-proxy-is-made";
import { generated } from "./generated/run-generated";

generated(
  "a trap is stored on the handler after the proxy is made",
  Array.from({ length: programs }, (_, index) => ({
    name: `program ${index}.`,
    isAlwaysRun: index % 150 === 0,
    isOnlyCompiled: true as const,
    keepsItsText: true as const,
    flags: flagsOf(index),
    make: () => programOf(index),
  })),
);
