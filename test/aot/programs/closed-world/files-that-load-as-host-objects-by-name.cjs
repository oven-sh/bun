// A require() or an import() under a name that is computed at run time finds the modules of the executable, and outside of it data: JSON, TOML, text.
// A file that loads as an object of Bun's, a page or a database, is refused like code: the compiler takes what such a load answers for a module it has seen or for plain data.
// An import that names the file is compiled in and works: bundler-features/html-import-in-server.
const fs = require("fs");
const os = require("os");
const path = require("path");
// Text that is decoded at run time is unknown to the compiler.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "loads-by-name-"));
const write = (name, text) => {
  fs.writeFileSync(path.join(folder, name), text);
  return decoded(path.join(folder, name));
};
function outcome(error) {
  const isRefusal = String(error.message).includes("it isn't in this executable");
  return isRefusal ? "refused, " + error.code : "throws " + error.name + ": " + error.message;
}
function required(label, name) {
  try {
    console.log(label + ": " + JSON.stringify(require(name)));
  } catch (error) {
    console.log(label + ": " + outcome(error));
  }
}
async function imported(label, name, options) {
  try {
    console.log(label + ": " + JSON.stringify((await import(name, options)).default));
  } catch (error) {
    console.log(label + ": " + outcome(error));
  }
}
async function main() {
  const data = write("data.json", '{ "a": [1, "b"] }');
  const settings = write("settings.toml", "a = 1\n");
  const note = write("note.txt", "text");
  const page = write("page.html", "<html></html>");
  const database = write("database.sqlite", "");
  required("require of JSON", data);
  required("require of TOML", settings);
  required("require of text", note);
  required("require of a page", page);
  await imported("import of JSON", data);
  await imported("import of a page", page);
  await imported("import of a database", database, { with: { type: decoded("sqlite") } });
  fs.rmSync(folder, { recursive: true });
}
main();
