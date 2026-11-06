// `bun run` prints the value of a leading `const mode = Mode.Fast` or `const size = "abc".length` in place of each read, so a function called through an import cycle before the file has run gets the value, not a ReferenceError.
import "./first.ts";
