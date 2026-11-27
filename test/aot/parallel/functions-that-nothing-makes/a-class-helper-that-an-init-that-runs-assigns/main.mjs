// The helper is undefined in front of the call that assigns it, and the published one behind it.
import { _createClass, init } from "./helpers.mjs";
function Box(size) { this.size = size; }
const define = () => _createClass(Box, [{ key: "twice", value: function twice() { return this.size * 2; } }], [{ key: "of", value: function of(size) { return new Box(size); } }]);
try { define(); console.log(new Box(2).twice()); } catch (e) { console.log(e.name, typeof _createClass, "twice" in Box.prototype); }
init();
console.log(define() === Box, new Box(2).twice(), Box.of(3).twice(), Object.keys(Box.prototype).length);
