// Species: proxy programs  entries of arrays strings proxies and instances. It prints what plain Bun prints.
const log = [];
class Point { constructor() { this.x = 1; this.y = "two"; } get sum() { return 3; } }
log.push(JSON.stringify([...new Map(Object.entries(["a", "b"]))]), JSON.stringify([...new Map(Object.entries("hi"))]), JSON.stringify([...new Map(Object.entries(new Point()))]));
const proxy = new Proxy({ p: 1 }, { get(target, key) { return key === "p" ? "trapped" : target[key]; }, ownKeys() { return ["p"]; } });
log.push(JSON.stringify([...new Map(Object.entries(proxy))]), JSON.stringify([...new Map(Object.entries(7))]));
try { Object.entries(null); } catch (error) { log.push(error.constructor.name); }
console.log(log.join("; "));
