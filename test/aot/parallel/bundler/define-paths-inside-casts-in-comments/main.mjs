// A cast in a comment has the range of what it casts, and is no link of the path.
// Flags: --define=EXP=exports --define=MOD=module --define=LEVEL=settings.level
// Reference: bun build --compile
import first from "./exports.js";
import second from "./module.js";
function read(settings) {
  return /** @type {number} */ (LEVEL);
}
console.log(first.a, second.b, read({ level: 3 }), String(read).includes("settings.level"));
