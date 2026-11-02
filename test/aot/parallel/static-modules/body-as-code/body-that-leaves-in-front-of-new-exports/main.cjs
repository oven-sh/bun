// A body that returns in front of `module.exports = ..` exports the object it began with.
globalThis.skip = true;
const show = (name, value) => console.log(name, typeof value, value === null ? "null" : typeof value === "object" ? JSON.stringify(value) : "");
show("if", require("./if.cjs"));
show("block", require("./block.cjs"));
show("switch", require("./switch.cjs"));
show("try", require("./try.cjs"));
show("loop", require("./loop.cjs"));
show("and", require("./stays.cjs"));
globalThis.skip = false;
show("not taken", require("./not-taken.cjs"));
