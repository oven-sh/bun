// A program compares the names of its files with one another. What the module system answers while the program runs agrees with itself, and so does what says where a file
// lay when the program was built: `__filename`, `__dirname` and require.resolve(). In an executable the two differ, as with `bun build --compile`.
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
      "argv[1] is module.filename": attempt(() => process.argv[1] === module.filename),
      "require.main.filename is module.filename": attempt(() => require.main.filename === module.filename),
      "module.path is the folder of module.filename": attempt(() => module.path === path.dirname(module.filename)),
      "__dirname is the folder of __filename": attempt(() => __dirname === path.dirname(__filename)),
      "both name one file": attempt(() => path.basename(module.filename) === path.basename(__filename)),
      "require.resolve answers the joined path": attempt(() => require.resolve("./other.cjs") === other),
      "require takes the joined path": attempt(() => require(other) === require("./other.cjs")),
      "a frame names module.filename": frame.includes(module.filename),
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
