// What is printed is what plain Bun prints.
const kept: string[][] = [];
function returned(text: string) { const parts = text.split("/"); return parts; }
function stored(text: string) { const parts = text.split("/"); kept.push(parts); return parts[1]; }
function handed(text: string) { const parts = text.split("/"); return JSON.stringify(parts) + parts.length; }
function joined(text: string) { const parts = text.split("/"); return parts.join("+") + parts[0]; }
function walked(text: string) { const parts = text.split("/"); let out = ""; for (const part of parts) out += "[" + part + "]"; return out + parts[1]; }
const list = returned("a/b/c");
list.push("d");
console.log("SAID " + [list.join(), stored("x/y"), kept[0]!.length, handed("p/q"), joined("m/n/o"), walked("u/v")].join(" "));
