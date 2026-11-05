// Files of a graph run between its import and its link.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
globalThis.log = [];
const show = title => {
  console.log(title, globalThis.log.join(" "));
  globalThis.log.length = 0;
};

// Files that need nothing, one by one and beside another import().
show("alone: " + (await import("./alone-root.mjs")).total);
const two = await Promise.all([import("./small.mjs"), import("./beside-root.mjs")]);
show("beside: " + two.map(each => each.total).join());

// A file requires a file that the graph imports too, a file that nobody imports, and an ES module.
show("nested: " + (await import("./nested-root.mjs")).total);

// A file names an ES module that it does not require before a later module of the graph imports it.
const lazy = await import("./lazy-root.mjs");
show("lazy: " + lazy.total + " " + lazy.late());

// A file changes what it exports behind its end, and a second graph imports it.
const first = await import("./changes-first.mjs");
show("changes: " + first.total);
first.change();
show("changes again: " + (await import("./changes-second.mjs")).total + " " + first.read());

// A file of the graph throws.
try {
  await import("./throws-root.mjs");
} catch (error) {
  show("throws: " + error.message);
}
try {
  await import("./throws-root.mjs");
} catch (error) {
  show("throws again: " + error.message);
}
