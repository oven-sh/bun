// require of ES modules with and without "module.exports", __esModule, JSON twice, computed require, import, require.resolve and import.meta.resolve from a nested folder, and each of them on a missing file.
const { pathToFileURL } = require("node:url");
const nestedCommonJS = require("./nested/resolver.cjs");

const computed = name => "./" + name;
const folderURL = pathToFileURL(__dirname).href;
const scrub = text => String(text).replaceAll(folderURL, "<url>").replaceAll(__dirname, "<folder>");

function describeError(error) {
  return [error.name, error.code, scrub(error.message)].join(" | ");
}

function attempt(what, run) {
  try {
    console.log(what + ":", scrub(run()));
  } catch (error) {
    console.log(what + ":", "throws", describeError(error));
  }
}

async function attemptAsync(what, run) {
  try {
    console.log(what + ":", scrub(await run()));
  } catch (error) {
    console.log(what + ":", "rejects", describeError(error));
  }
}

function requireESModules() {
  const plain = require("./esm-plain.mjs");
  console.log("plain", Object.keys(plain).join(), plain.value, plain.default, plain.__esModule);
  console.log("plain twice", require("./esm-plain.mjs") === plain, require(computed("esm-plain.mjs")) === plain);

  const replaced = require("./esm-module-exports.mjs");
  console.log("module.exports", typeof replaced, replaced.name, replaced.ignored, require("./esm-module-exports.mjs") === replaced);

  const nullish = require("./esm-null-module-exports.mjs");
  console.log("null module.exports", Object.keys(nullish).join(), nullish.value);

  const flagged = require("./esm-flagged.mjs");
  console.log("flagged", flagged.__esModule, flagged.default, Object.keys(flagged).join());

  const unflagged = require("./esm-unflagged.mjs");
  console.log("unflagged", unflagged.__esModule, unflagged.value, Object.keys(unflagged).join());
  return plain;
}

function requireJSON() {
  const first = require("./data.json");
  first.added = "added to the first object";
  const second = require("./data.json");
  console.log("json twice", first === second, second.added, second.name, second.list.join());
  console.log("json computed", require(computed("data.json")) === first);
  return first;
}

function requireCommonJS() {
  const counted = require("./counted.cjs");
  console.log("commonjs", counted.runs, require("./counted.cjs") === counted);
  const replaced = require("./replaces-exports.cjs");
  replaced.replace("the second value");
  console.log("exports replaced after evaluation", replaced.current, require("./replaces-exports.cjs"));
}

async function importAll(plain) {
  const namespace = await import("./esm-plain.mjs");
  console.log("import", namespace.value, namespace === plain, (await import(computed("esm-plain.mjs"))) === namespace);
  console.log("import of commonjs", (await import("./counted.cjs")).default.runs, (await import(computed("counted.cjs"))).default.runs);
  console.log("import of json", (await import("./data.json")).default.name, (await import(computed("data.json"))).name);
  console.log("import from nested", await nestedCommonJS.importSibling(), await nestedCommonJS.importParent());
}

async function resolveAll() {
  attempt("require.resolve", () => require.resolve("./data.json"));
  attempt("require.resolve computed", () => require.resolve(computed("esm-plain.mjs")));
  attempt("require.resolve of a builtin", () => require.resolve("node:fs"));
  attempt("nested require.resolve", () => nestedCommonJS.resolveSibling());
  attempt("nested require.resolve of the parent", () => nestedCommonJS.resolveParent());
  attempt("nested require.resolve computed", () => nestedCommonJS.resolveComputed("sibling.cjs"));

  const nestedESM = await import("./nested/resolver.mjs");
  attempt("import.meta.resolve", () => nestedESM.resolveSibling());
  attempt("import.meta.resolve of the parent", () => nestedESM.resolveParent());
  attempt("import.meta.resolve computed", () => nestedESM.resolveComputed("sibling.cjs"));
  attempt("import.meta.resolve of a builtin", () => nestedESM.resolveComputed("node:fs"));
  attempt("import.meta.require", () => nestedESM.requireSibling());
  return nestedESM;
}

async function missingFiles(nestedESM) {
  attempt("require missing", () => require("./missing.cjs"));
  attempt("require missing computed", () => require(computed("missing.cjs")));
  attempt("require missing package", () => require("not-installed-package"));
  attempt("require of a number", () => require(computed.length));
  attempt("require.resolve missing", () => require.resolve("./missing.cjs"));
  attempt("require.resolve missing computed", () => require.resolve(computed("missing.cjs")));
  attempt("nested require missing", () => nestedCommonJS.requireComputed("missing.cjs"));
  attempt("nested require.resolve missing", () => nestedCommonJS.resolveComputed("missing.cjs"));
  attempt("import.meta.resolve missing", () => nestedESM.resolveComputed("missing.cjs"));
  attempt("import.meta.resolve missing package", () => nestedESM.resolveComputed("not-installed-package"));

  await attemptAsync("import missing", () => import("./missing.mjs"));
  await attemptAsync("import missing computed", () => import(computed("missing.mjs")));
  await attemptAsync("import missing package", () => import("not-installed-package"));
  await attemptAsync("nested import missing", () => nestedCommonJS.importComputed("missing.mjs"));
  await attemptAsync("import with options that are not an object", () => import(computed("esm-plain.mjs"), 1));
  await attemptAsync("import of a specifier that throws", () =>
    import({
      toString() {
        throw new RangeError("thrown by toString");
      },
    }),
  );
}

async function main() {
  const plain = requireESModules();
  requireJSON();
  requireCommonJS();
  await importAll(plain);
  const nestedESM = await resolveAll();
  await missingFiles(nestedESM);
}

main();
