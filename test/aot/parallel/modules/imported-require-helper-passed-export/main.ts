// The `require` of another file comes through `export * from`, once and twice over. A file that passes everything on can export names of its own beside it.
import { __require } from "./passes-all-on.mjs";
import { __require as twice, own } from "./passes-all-on-again.mjs";
console.log(__require("./once.cjs"), twice("./twice.cjs"), own("./own.cjs"));
