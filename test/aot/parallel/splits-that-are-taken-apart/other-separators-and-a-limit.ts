// What is printed is what plain Bun prints.
const two = (text: string) => { const parts = text.split("::"); return parts.length + ":" + parts[1]; };
const none = (text: string) => { const parts = text.split(""); return parts.length + ":" + parts[1]; };
const limited = (text: string) => { const parts = text.split("/", 2); return parts.length + ":" + parts[1] + ":" + parts[2]; };
const unwritten = (text: string, separator: string) => { const parts = text.split(separator); return parts.length + ":" + parts[1]; };
const absent = (text: string) => { const parts = text.split(undefined as unknown as string); return parts.length + ":" + parts[0]; };
console.log("SAID " + [two("a::b::c"), none("abc"), limited("a/b/c/d"), unwritten("a-b-c", "-"), unwritten("a-b-c", "--"), absent("a/b")].join(" "));
