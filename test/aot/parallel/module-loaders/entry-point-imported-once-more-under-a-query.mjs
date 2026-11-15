// `bun run` asks an ES module whether its file is the one that it was started with: the second module of the file is as much the main module as the first.
globalThis.runs = (globalThis.runs ?? 0) + 1;
export const run = globalThis.runs;
export const isMain = import.meta.main;
if (run === 1) {
  const again = await import("./entry-point-imported-once-more-under-a-query.mjs?again");
  console.log(run, again.run, isMain, again.isMain);
}
