// No name in the source tells that the program needs the code behind Array.prototype.flatMap. The build learns it from the flow analysis,
// and makes code only of the program that has it. For that program it parses only those of Bun's own files that it has not parsed yet.
// STATISTIC: EngineRuns = 2
// STATISTIC: WholeEngineRuns = 1
// STATISTIC: SourceFilesOfBunParsed <= 8
const method = Reflect.get(Array.prototype, "flat" + "Map");
console.log(method.call([1, 2], x => [x, x * 2]).join());
