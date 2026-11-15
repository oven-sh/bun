// process.mainModule, taken out by Object.entries in a program in which no file names a way to a module object.
// An earlier compiler compiled it again, with every start-up module: EngineRuns = 2, WholeEngineRuns = 1, SourceFilesOfBunParsed >= 100. A build runs the engine once now.
const found = Object.entries(process).filter(([key]) => key.startsWith("mainM"));
console.log(found.map(([key, value]) => key + ":" + typeof value + " " + value.id).join());
