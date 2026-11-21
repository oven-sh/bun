// A text that the build cannot read imports node:path behind the link of the entry and stores into its default: the named imports of the entry and the namespace of that import() keep what the link found.
import { sep, join } from "node:path";
// The text is cut at a number of the run, so the build cannot work it out.
const runUnseen = text => new Function(text.slice(process.argv.length - process.argv.length))();
const said = await runUnseen(
  `return import("node:path").then(names => {
    names.default.sep = "!";
    names.default.join = () => "patched";
    return names.sep + " " + names.join("a", "b") + " " + names.default.sep + " " + names.default.join("a", "b");
  });`,
);
console.log(sep, join("a", "b"), "|", said);
