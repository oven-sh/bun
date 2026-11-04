// `import defer` puts off when a file runs, not when it is linked. A CommonJS file that the deferred file imports runs when the graph is loaded, ahead of every ES module of the graph, and the names that are imported from it are looked for then.
console.log("# also-loaded-by-a-call");
await import("./also-loaded-by-a-call/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# also-named-by-a-call-that-never-runs");
await import("./also-named-by-a-call-that-never-runs/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# a-member-is-read");
await import("./a-member-is-read/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# nothing-is-read");
await import("./nothing-is-read/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-keys-are-listed");
await import("./the-keys-are-listed/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# imported-and-then-exported");
await import("./imported-and-then-exported/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# exported-by-a-star");
await import("./exported-by-a-star/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-default-import");
await import("./the-default-import/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# used-in-the-deferred-file");
await import("./used-in-the-deferred-file/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# behind-one-more-file");
await import("./behind-one-more-file/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-file-that-runs-at-once-is-imported-first");
await import("./a-file-that-runs-at-once-is-imported-first/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# a-file-that-runs-at-once-is-imported-last");
await import("./a-file-that-runs-at-once-is-imported-last/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# two-commonjs-files");
await import("./two-commonjs-files/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-commonjs-file-requires-another");
await import("./the-commonjs-file-requires-another/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-getter");
await import("./a-getter/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# below-two-deferred-imports");
await import("./below-two-deferred-imports/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# the-deferred-import-stands-in-an-imported-file");
await import("./the-deferred-import-stands-in-an-imported-file/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
console.log("# the-deferred-file-awaits");
await import("./the-deferred-file-awaits/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# required-as-well");
await import("./required-as-well/reader.mjs").catch(error => console.log("rejected:", error.message));
console.log("# a-name-that-the-file-does-not-store");
await import("./a-name-that-the-file-does-not-store/reader.mjs").catch(error =>
  console.log("rejected:", error.message),
);
