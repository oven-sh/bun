// `bun run` prints the value of a leading `const limit = 5` in place of each read, so a function called through an import cycle before the file has run gets 5, not a ReferenceError.
import "./first.mjs";
