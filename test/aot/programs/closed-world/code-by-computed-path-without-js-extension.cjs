// Whatever Bun would read as JavaScript is refused like a .js file that is not in the executable: no extension, an unknown extension, Markdown, a data: URL.
const fs = require("fs");
const os = require("os");
const path = require("path");
// The compiler can't see text that is decoded at run time.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "code-files-"));
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
    console.log("require of " + label + ": " + JSON.stringify(require(name)));
  } catch (error) {
    console.log("require of " + label + ": " + outcome(error));
  }
}
async function imported(label, name) {
  try {
    console.log("import of " + label + ": " + JSON.stringify((await import(name)).default));
  } catch (error) {
    console.log("import of " + label + ": " + outcome(error));
  }
}
async function main() {
  const noExtension = write("code", "module.exports = 1;");
  const unknownExtension = write("code.unknown", "module.exports = 2;");
  const markdown = write("page.md", "# title\n");
  required("a file with no extension", noExtension);
  required("a file with an unknown extension", unknownExtension);
  required("a Markdown file", markdown);
  await imported("a file with no extension", noExtension);
  await imported("a Markdown file", markdown);
  await imported("a data: URL", decoded("data:text/javascript,export default 3"));
  fs.rmSync(folder, { recursive: true });
}
main();
