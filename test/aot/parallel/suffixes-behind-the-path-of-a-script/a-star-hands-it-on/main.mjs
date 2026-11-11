export * from "./job.mjs?sharedworker";
console.log("behind the export");
// The build writes the module that `bun run` loads in place of the file.
