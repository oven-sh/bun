// What is printed is what plain Bun prints.
function frozen(text: string) { const parts = text.split("/"); Object.freeze(parts); return [Object.isFrozen(parts), parts[1], parts.length].join(); }
function holed(text: string) { const parts = text.split("/"); delete parts[1]; return [1 in parts, parts[1], parts.length].join(); }
function written(text: string) { const parts = text.split("/"); parts[1] = "new"; return [parts[1], parts[0], parts.length].join(); }
function cut(text: string) { const parts = text.split("/"); parts.length = 1; return [parts[1], parts[0], parts.length].join(); }
function grown(text: string) { const parts = text.split("/"); parts[5] = "far"; return [parts[5], parts[4], parts.length].join(); }
console.log("SAID " + [frozen, holed, written, cut, grown].map(form => form("a/b/c")).join(" "));
