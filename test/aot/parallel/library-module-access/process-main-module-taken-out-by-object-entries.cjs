// process.mainModule, taken out by Object.entries in a program in which no file names a way to a module object.
// Alone: what another program of the executable names decides what this one finds.
// It is compiled again, and holds every start-up module the first time: the second load takes nothing over from the first.
// STATISTIC: EngineRuns = 2
// STATISTIC: WholeEngineRuns = 1
// STATISTIC: SourceFilesOfBunParsed >= 100
const found = Object.entries(process).filter(([key]) => key.startsWith("mainM"));
console.log(found.map(([key, value]) => key + ":" + typeof value + " " + value.id).join());
