// Two CommonJS files as esbuild 0.12 and 0.13 write them: the helper that defines a getter for each name of a list first defines `__esModule`.
// One of the files has a `default` in its list. A module imports both defaults, another file requires both files.
import withDefault, { number } from "./with-default.cjs";
import withoutDefault from "./without-default.cjs";
import "./requires-both.cjs";

console.log(withDefault, number);
console.log(withoutDefault.number, withoutDefault.__esModule, Object.keys(withoutDefault).join());
