// Options that name no type are read through type assertions, so the file is held as code alone.
// STATISTIC: SourceFilesData <= 0
// STATISTIC: SourceFilesInferred <= 0
const m = await import("./part.ts", { with: {} as any } as any);
console.log(Object.keys(m).join());
