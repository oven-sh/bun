// Todo: An executable does not hold where a statement is in its source, so the error of a link has no stack, line, column or sourceURL there. Plain Bun finds the statement in the source of the module.
// The error of a link says where its statement is: the file, and the line and the column of the name that the other module does not export.
const withoutFolders = text => String(text).replace(/[^\s'(]*[\\/]/g, "");
async function load(label, importModule) {
  try {
    console.log(label, "loaded", Object.keys(await importModule()).join());
  } catch (error) {
    console.log(label, "|", withoutFolders(error.stack), "|", error.line, error.column, withoutFolders(error.sourceURL));
  }
}
await load("an import", () => import("./imports-an-absent-name.mjs"));
await load("an export from", () => import("./exports-an-absent-name.mjs"));
