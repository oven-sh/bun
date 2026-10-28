// require() and import() of a path computed at run time load data files from disk, as in plain Bun.
const fs = require("fs");
const os = require("os");
const path = require("path");
// The compiler can't see text that is decoded at run time.
const decoded = text => Buffer.from(text).toString();

const folder = fs.mkdtempSync(path.join(os.tmpdir(), "data-files-"));
const write = (name, text) => {
  fs.writeFileSync(path.join(folder, name), text);
  return decoded(path.join(folder, name));
};
const shown = value => String(JSON.stringify(value)).replaceAll(folder, "<folder>");
const thrown = error => "throws " + error.name + ": " + String(error.message).replaceAll(folder, "<folder>");

function required(label, name) {
  try {
    console.log("require of " + label + ": " + shown(require(name)));
  } catch (error) {
    console.log("require of " + label + ": " + thrown(error));
  }
}
async function imported(label, name, options) {
  try {
    console.log("import of " + label + ": " + shown((await import(name, options)).default));
  } catch (error) {
    console.log("import of " + label + ": " + thrown(error));
  }
}
async function main() {
  const files = {
    "JSON": write("data.json", '{ "a": [1, "b"] }'),
    "JSONC": write("data.jsonc", '{ /* comment */ "a": 1, }'),
    "tsconfig.json": write("tsconfig.json", '{ /* comment */ "a": 1, }'),
    "JSON5": write("data.json5", "{ a: 1, }"),
    "TOML": write("data.toml", "a = 1\n"),
    "YAML": write("data.yaml", "a: 1\nb: [x, y]\n"),
    "XML": write("data.xml", "<a><b>1</b></a>"),
    "text": write("data.txt", "text"),
    "CSS": write("data.css", "a { color: red }"),
    "invalid JSON": write("invalid.json", "{"),
    "invalid TOML": write("invalid.toml", "a = = 1"),
    "empty JSON": write("empty.json", ""),
    "empty TOML": write("empty.toml", ""),
    "empty text": write("empty.txt", ""),
  };
  for (const [label, name] of Object.entries(files)) required(label, name);
  for (const [label, name] of Object.entries(files)) await imported(label, name);
  await imported("TOML as text", files.TOML, { with: { type: decoded("text") } });
  await imported("text as JSON", files.text, { with: { type: decoded("json") } });
  await imported("TOML as a file", files.TOML, { with: { type: decoded("file") } });
  fs.rmSync(folder, { recursive: true });
}
main();
