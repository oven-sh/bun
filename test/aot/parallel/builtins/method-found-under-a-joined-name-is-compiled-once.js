// No name in the source tells that the program needs the code behind Array.prototype.flatMap. The executable holds it all the same.
// An earlier compiler learned it from a first run of the engine and compiled the program again: EngineRuns = 2, WholeEngineRuns = 1, SourceFilesOfBunParsed <= 8. A build runs the engine once now.
const method = Reflect.get(Array.prototype, "flat" + "Map");
console.log(method.call([1, 2], x => [x, x * 2]).join());
