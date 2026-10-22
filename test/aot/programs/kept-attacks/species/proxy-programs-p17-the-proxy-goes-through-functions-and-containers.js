// Species: proxy programs  the proxy goes through functions and containers. It prints what plain Bun prints.
const log = [];
class Body { constructor(n) { this.hits = n; } bump() { this.hits++; return this; } }
function pass(x) { return x; }
function bumpTwice(x) { return x.bump().bump(); }
const b = new Body(1);
const list = [pass(new Proxy(b, {}))]; const map = new Map([["k", list[0]]]);
bumpTwice(map.get("k")); bumpTwice(new Body(10));
log.push(String(b.hits), String(list[0].hits), String(list[0] === map.get("k")));
console.log(log.join("; "));
