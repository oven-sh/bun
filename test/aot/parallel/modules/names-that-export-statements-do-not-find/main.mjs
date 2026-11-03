// `export { name } from` where only the run knows the names of the other module: the error of the link quotes the statement, has no stack, and comes ahead of the error of an import.
const withoutFolders = text => String(text).replace(/'[^']*[\\/]([^\\/']+)'/g, "'$1'");
async function load(label, importModule) {
  try {
    console.log(label, "loaded", Object.keys(await importModule()).join());
  } catch (error) {
    console.log(
      label,
      error.name,
      withoutFolders(error.message),
      "|",
      error.stack,
      error.line,
      error.column,
      error.sourceURL,
    );
  }
}
await load("two stars, absent", () => import("./two-stars-absent.mjs"));
await load("two stars, absent, again", () => import("./two-stars-absent.mjs"));
await load("two stars, in both", () => import("./two-stars-in-both.mjs"));
await load("two stars, renamed", () => import("./two-stars-renamed.mjs"));
await load("two stars, several", () => import("./two-stars-several.mjs"));
await load("two stars, an import in front", () => import("./two-stars-import-in-front.mjs"));
await load("two stars, imported then exported", () => import("./two-stars-imported-then-exported.mjs"));
await load("two stars, no extension", () => import("./two-stars-no-extension.mjs"));
await load("two stars, found", () => import("./two-stars-found.mjs"));
await load("two stars, imported", () => import("./two-stars-imported.mjs"));
await load("one star, absent", () => import("./one-star-absent.mjs"));
await load("one star, renamed", () => import("./one-star-renamed.mjs"));
await load("one star, an import in front", () => import("./one-star-import-in-front.mjs"));
await load("one star, imported then exported", () => import("./one-star-imported-then-exported.mjs"));
await load("one star, the marker", () => import("./one-star-marker.mjs"));
await load("one star, stored on some runs", () => import("./one-star-stored-on-some-runs.mjs"));
await load("one star, imported", () => import("./one-star-imported.mjs"));
await load("no star, absent", () => import("./no-star-absent.mjs"));
await load("no star, renamed", () => import("./no-star-renamed.mjs"));
await load("no star, imported", () => import("./no-star-imported.mjs"));
await load("a package", () => import("./of-a-package.mjs"));
await load("a module of Node.js", () => import("./of-node-fs.mjs"));
await load("a module of Node.js, without the prefix", () => import("./of-fs.mjs"));
await load("a chain", () => import("./chain.mjs"));
