// SlowBuffer.prototype is Buffer.prototype: what a program reads through the one is a use of the other.
import { SlowBuffer } from "node:buffer";

function offset() { return SlowBuffer.prototype.offset; }
function parent() { return SlowBuffer.prototype.parent; }
console.log(offset(), parent(), SlowBuffer.prototype === Buffer.prototype);
