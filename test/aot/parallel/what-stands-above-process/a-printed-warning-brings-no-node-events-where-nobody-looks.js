// A program that cannot look above `process` cannot tell whether node:events was loaded, and does without the module. A name that it has laid on `process` itself is found below.
// STATISTIC: FunctionsLowered <= 602
Object.defineProperty(process, "markOfThisProgram", { value: "mark", configurable: true });
process.shelfOfThisProgram = "shelf";
process.emitWarning("made-up words");
setImmediate(() =>
  console.log(
    process.markOfThisProgram,
    process.shelfOfThisProgram,
    process.madeUpName,
    "madeUpName" in process,
    typeof process.pid,
  ),
);
