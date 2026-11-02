// Prints what is thrown where a member of a module is named above the `var` that holds what `require` answers: the message names the member. What stands in front of the member in the message is left out: docs/compiler/compatibility.mdx#error-messages.
const show = (label, run) => { try { console.log(label, run()); } catch (error) { console.log(label, error.constructor.name, error.message.replace(/evaluating '[\w.]*?(\.\w+|\[.*\])'/, "evaluating '?$1'"), String(error.stack).split("\n")[1].replace(/.*:(\d+:\d+)\)?$/, "$1")); } };
show("read", () => early.x);
show("read marker", () => early.__esModule);
show("read deep", () => early.inner.x);
show("call", () => early.run());
show("update", () => { early.x += 1; });
show("increment", () => { early.x++; });
show("bracket", () => early["x"]);
show("typeof", () => typeof early.x);
show("commonjs read", () => plain.y);
show("commonjs call", () => plain.go());
try { console.log(early.x); } catch (error) { console.log("top", error.constructor.name, error.message.replace(/evaluating '[\w.]*?(\.\w+)'/, "evaluating '?$1'")); }
var early = require("./e.mjs");
var plain = require("./c.cjs");
show("late read", () => early.x);
show("late call", () => early.run());
show("late commonjs", () => plain.y + plain.go());
