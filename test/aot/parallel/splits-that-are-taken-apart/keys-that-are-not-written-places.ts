// What is printed is what plain Bun prints.
function under(text: string, key: number) { const parts = text.split("/"); return String(parts[key]) + parts.length; }
function named(text: string) { const parts = text.split("/") as string[] & { index?: number; input?: string }; return [parts.index, parts.input, parts[1]].map(String).join(); }
function far(text: string) { const parts = text.split("/"); return String(parts[70]) + String(parts[63]) + parts[0]; }
function last(text: string) { const parts = text.split("/"); return String(parts.at(-1)) + parts[parts.length - 1]; }
console.log("SAID " + [under("a/b/c", 2), under("a/b/c", 9), under("a/b/c", -1), named("a/b"), far("a/b"), last("a/b/c")].join(" "));
