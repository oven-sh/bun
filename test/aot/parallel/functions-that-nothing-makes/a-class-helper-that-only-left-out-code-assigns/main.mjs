// A helper that defines a class's members and that only a function that nobody calls would assign is never made. Calls of it build and throw as in bun run.
import { _createClass } from "./helpers.mjs";
function Box(size) { this.size = size; }
try {
  _createClass(Box, [{ key: "twice", value: function twice() { return this.size * 2; } }]);
  console.log(new Box(2).twice());
} catch (e) { console.log(e.name, typeof _createClass, "twice" in Box.prototype); }
