// A program compares the names of its files with one another.
// Alone: it asks which file the executable was started as
import { fileURLToPath } from "node:url";
const separators = text => (text.includes("\\") ? (text.includes("/") ? "both" : "backslashes") : "slashes");
const attempt = answer => {
  try {
    return answer();
  } catch (error) {
    return error.name;
  }
};
const frame = new Error().stack.split("\n")[1];
console.log(
  JSON.stringify(
    {
      "argv[1] is the path of import.meta.url": process.argv[1] === fileURLToPath(import.meta.url),
      "argv[1] is import.meta.path": process.argv[1] === import.meta.path,
      "Bun.main is import.meta.path": Bun.main === import.meta.path,
      "import.meta.main": import.meta.main,
      "a frame names import.meta.path": frame.includes(import.meta.path),
      "separators": [process.argv[1], Bun.main, import.meta.path, frame.slice(frame.indexOf("at ") + 3)]
        .map(separators)
        .join(),
    },
    null,
    1,
  ),
);
