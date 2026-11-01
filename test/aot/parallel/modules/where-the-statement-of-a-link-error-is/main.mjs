// A name that only the run knows to be absent from the other module: the error of the link says where its statement is, in its stack, line, column and sourceURL.
// Todo: An executable does not hold where a statement is in its source, so the error of a link has no stack, line, column or sourceURL there. Plain Bun finds the statement in the source of the module.
const withoutFolders = text => String(text).replace(/[^\s'(]*[\\/]/g, "");
async function load(label, importModule) {
  try {
    console.log(label, "loaded", Object.keys(await importModule()).join());
  } catch (error) {
    console.log(
      label,
      "|",
      withoutFolders(error.stack),
      "|",
      error.line,
      error.column,
      withoutFolders(error.sourceURL),
    );
  }
}
await load("two stars, absent", () => import("../names-that-export-statements-do-not-find/two-stars-absent.mjs"));
await load(
  "two stars, absent, again",
  () => import("../names-that-export-statements-do-not-find/two-stars-absent.mjs"),
);
await load("two stars, in both", () => import("../names-that-export-statements-do-not-find/two-stars-in-both.mjs"));
await load("two stars, renamed", () => import("../names-that-export-statements-do-not-find/two-stars-renamed.mjs"));
await load("two stars, several", () => import("../names-that-export-statements-do-not-find/two-stars-several.mjs"));
await load(
  "two stars, an import in front",
  () => import("../names-that-export-statements-do-not-find/two-stars-import-in-front.mjs"),
);
await load(
  "two stars, imported then exported",
  () => import("../names-that-export-statements-do-not-find/two-stars-imported-then-exported.mjs"),
);
await load(
  "two stars, no extension",
  () => import("../names-that-export-statements-do-not-find/two-stars-no-extension.mjs"),
);
await load("two stars, found", () => import("../names-that-export-statements-do-not-find/two-stars-found.mjs"));
await load("two stars, imported", () => import("../names-that-export-statements-do-not-find/two-stars-imported.mjs"));
await load("one star, absent", () => import("../names-that-export-statements-do-not-find/one-star-absent.mjs"));
await load("one star, renamed", () => import("../names-that-export-statements-do-not-find/one-star-renamed.mjs"));
await load(
  "one star, an import in front",
  () => import("../names-that-export-statements-do-not-find/one-star-import-in-front.mjs"),
);
await load(
  "one star, imported then exported",
  () => import("../names-that-export-statements-do-not-find/one-star-imported-then-exported.mjs"),
);
await load("one star, the marker", () => import("../names-that-export-statements-do-not-find/one-star-marker.mjs"));
await load(
  "one star, stored on some runs",
  () => import("../names-that-export-statements-do-not-find/one-star-stored-on-some-runs.mjs"),
);
await load("one star, imported", () => import("../names-that-export-statements-do-not-find/one-star-imported.mjs"));
await load("no star, absent", () => import("../names-that-export-statements-do-not-find/no-star-absent.mjs"));
await load("no star, renamed", () => import("../names-that-export-statements-do-not-find/no-star-renamed.mjs"));
await load("no star, imported", () => import("../names-that-export-statements-do-not-find/no-star-imported.mjs"));
await load("a package", () => import("../names-that-export-statements-do-not-find/of-a-package.mjs"));
await load("a module of Node.js", () => import("../names-that-export-statements-do-not-find/of-node-fs.mjs"));
await load(
  "a module of Node.js, without the prefix",
  () => import("../names-that-export-statements-do-not-find/of-fs.mjs"),
);
await load("a chain", () => import("../names-that-export-statements-do-not-find/chain.mjs"));
