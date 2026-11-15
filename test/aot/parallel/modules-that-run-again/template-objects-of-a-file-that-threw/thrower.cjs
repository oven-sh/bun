const tag = (strings) => strings;
globalThis.seen = globalThis.seen || [];
globalThis.seen.push(tag`a${1}b`);
if (globalThis.seen.length === 1) throw new Error("first run");
module.exports = 1;
