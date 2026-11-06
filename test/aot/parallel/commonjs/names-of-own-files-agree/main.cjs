// A program compares the names of its files with one another.
// Alone: it asks which file the executable was started as
const path = require("node:path");
const separators = text => (text.includes("\\") ? (text.includes("/") ? "both" : "backslashes") : "slashes");
const attempt = answer => {
  try {
    return answer();
  } catch (error) {
    return error.name;
  }
};
require("./other.cjs");
const other = path.join(__dirname, "other.cjs");
const frame = new Error().stack.split("\n")[1];
console.log(
  JSON.stringify(
    {
      "argv[1] is __filename": attempt(() => process.argv[1] === __filename),
      "require.main.filename is __filename": attempt(() => require.main.filename === __filename),
      "module.filename is __filename": attempt(() => module.filename === __filename),
      "module.path is __dirname": attempt(() => module.path === __dirname),
      "require.resolve answers the joined path": attempt(() => require.resolve("./other.cjs") === other),
      "require takes the joined path": attempt(() => require(other) === require("./other.cjs")),
      "a frame names __filename": frame.includes(__filename),
      "separators": [
        process.argv[1],
        __filename,
        attempt(() => require.resolve("./other.cjs")),
        frame.slice(frame.indexOf("(") + 1),
      ]
        .map(separators)
        .join(),
    },
    null,
    1,
  ),
);
