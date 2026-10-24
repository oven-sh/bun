// Species: proxy programs  a url setter through an unknown receiver runs tostring of the value. It prints what plain Bun prints.
const log = [];
class Tag { constructor() { this.count = 1; } toString() { this.count = "text"; return "#frag"; } twice() { return this.count + this.count; } }
globalThis.__box = new URL("http://example.com/a");
const tag = new Tag(); log.push(String(tag.twice()));
globalThis.__box.hash = tag;
log.push(String(tag.twice()), globalThis.__box.href, String(new Tag().twice()));
console.log(log.join("; "));
