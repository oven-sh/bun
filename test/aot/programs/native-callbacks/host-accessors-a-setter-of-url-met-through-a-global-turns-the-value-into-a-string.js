// A URL is kept under a name of the global object and read back. The store to its hash runs toString of the value, which puts a string into a field that held a number.
const log = [];
class Tag { constructor() { this.count = 1; } toString() { this.count = "text"; return "#frag"; } twice() { return this.count + this.count; } }
globalThis.__box = new URL("http://example.com/a");
const tag = new Tag(); log.push(String(tag.twice()));
globalThis.__box.hash = tag;
log.push(String(tag.twice()), globalThis.__box.href, String(new Tag().twice()));
console.log(log.join("; "));
