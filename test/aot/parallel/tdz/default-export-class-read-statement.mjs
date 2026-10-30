// @bun
// The file imports its own default export and reads it above the statement that exports it. Its first line is the one that `bun build --target=bun` writes.
import value from "./default-export-class-read-statement.mjs";
function attempt(read) {
  try {
    console.log(typeof read());
  } catch (error) {
    console.log(error.name);
  }
}
attempt(() => value);
export default class {
  static first = 1;
}
attempt(() => value);
