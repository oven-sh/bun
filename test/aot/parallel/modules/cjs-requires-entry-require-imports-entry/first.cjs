const lines = (globalThis.lines ??= []);
lines.push("first begins");
lines.push("first got " + Object.keys(require("./back.mjs")).join());
lines.push("first ends");
