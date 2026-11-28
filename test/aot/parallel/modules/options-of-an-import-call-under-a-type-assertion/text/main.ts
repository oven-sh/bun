// Options that name no type are read through a type assertion, so the file is held for one loader alone.
// STATISTIC: SourceFilesData <= 1
// STATISTIC: SourceFilesInferred <= 0
const m = await import("./part.txt", {} as any);
console.log(typeof m.default);
