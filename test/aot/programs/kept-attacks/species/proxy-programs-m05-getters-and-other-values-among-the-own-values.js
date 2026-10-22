// Species: proxy programs  getters and other values among the own values. It prints what plain Bun prints.
const log = [];
class Body { constructor() { this.hits = 1; } }
const source = { plain: 1, get made() { log.push("getter " + (this === source)); return new Body(); }, text: "t", nothing: undefined, fn() { return 5; } };
Object.defineProperty(source, "hidden", { value: "no", enumerable: false });
const map = new Map(Object.entries(source));
log.push(map.size, map.get("made").hits, typeof map.get("text"), typeof map.get("nothing"), map.get("fn")(), map.has("hidden"));
console.log(log.join("; "));
