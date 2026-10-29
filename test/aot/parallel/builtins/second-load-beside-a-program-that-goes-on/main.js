// Two programs in one executable. This one is compiled again, with the code behind Array.prototype.flatMap; the other is made at once.
// The load of the program that is compiled again parses only what no load of the build has parsed, though the other program has gone on meanwhile.
// Flags: --aot-separate-programs
// Entry points: ./other.js
// STATISTIC: EngineRuns = 3
// STATISTIC: WholeEngineRuns = 2
// STATISTIC: SourceFilesOfBunParsed <= 8
const method = Reflect.get(Array.prototype, "flat" + "Map");
console.log(method.call([1, 2], x => [x, x * 2]).join());
