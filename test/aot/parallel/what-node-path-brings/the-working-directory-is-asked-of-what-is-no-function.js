// The message names no binding of the library. What the engine adds to it is cut off.
const { posix, win32 } = require("node:path");
for (const held of [undefined, 5, {}]) {
  process.cwd = held;
  for (const ask of [() => posix.resolve("a"), () => posix.resolve(), () => win32.resolve("a"), () => win32.resolve("Q:a")]) {
    try {
      ask();
    } catch (error) {
      console.log(error.name, error.message.split(". ")[0], error.message.includes("$"));
    }
  }
}
