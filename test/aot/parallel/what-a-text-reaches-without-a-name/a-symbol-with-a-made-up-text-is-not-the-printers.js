// The printer of the host looks for one symbol. A symbol that is made with another written text cannot be it.
// STATISTIC: FunctionsLowered <= 30
// STATISTIC: SourceFilesRuntime <= 12
const mark = Symbol.for("a made-up text");
console.log(Symbol.keyFor(mark), typeof mark, mark === Symbol.for("a made-up text"));
