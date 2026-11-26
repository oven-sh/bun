// Traps that compare the key with names: for keys of every kind.
const log = [];
function shop(open, dear) {
  return function (goods, word) {
    if (word === "bread") return dear ? 4 : 2;
    if (word === "open") return open;
    if (word === "price of " + "salt") return dear ? "much" : "little";
    if (word === "Āwide") return "wide";
    const number = goods[word];
    return typeof number === "number" && dear ? number * 2 : number;
  };
}
const morning = {
  get: shop(true, false),
  set(goods, word, value) {
    if (word === "sign" || word === "door" || word === "lock") return false;
    log.push(typeof word === "symbol" ? "symbol" : word);
    goods[word] = value;
    return true;
  },
  has: (goods, word) => word === "everything" || word === "air" || word === "sa" + "lt" || word in goods,
};
const night = { get: shop(false, true), set: () => true };
const market = { ...morning, get: shop(true, true) };
class Stall {
  constructor(town) { this.town = town; }
  get(goods, word) {
    switch (word) { case "first": return this.town + 1; case "second": return this.town + 2; }
    if (word === "third" || word === "fourth" || word === "fifth") return this.town + word;
    return goods[word];
  }
  has(goods, word) { if (word === "one" || word === "two" || word === "three") return true; return word in goods; }
}
function show(v) { return typeof v === "function" ? "function" : typeof v === "symbol" ? "symbol" : v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : String(v) : Array.isArray(v) ? "array" : "object"; }
const long = "br" + "x".repeat(40).slice(0, 0) + ["e", "ad"].join("");
const words = ["bread", "open", "price of salt", "Āwide", "a", "b", "c", "0", 1, "01", "", long, "bread ".trim(), "breaD", "Open", "op" + "en", "constructor", "toString", "length", Symbol.iterator, Symbol.toPrimitive, "everything", "air", "salt", "everythinG", "first", "second", "third", "fourth", "fifth", "sixth", "one", "two", "three", "four", null, undefined, true, 1.5, -0, 2 ** 32];
const counters = [{ a: 1, b: { c: 2 }, c: -0 }, [1, { a: 2 }, "x"], Object.create({ a: 5, get b() { return this === undefined; } }), Object.assign(Object.create(null), { a: "text", sign: 1 }), new (class { a = 1; get b() { return this.a; } })()];
for (let turn = 0; turn < 3; turn++) {
  for (const goods of counters) {
    for (const p of [new Proxy(goods, morning), new Proxy(goods, night), new Proxy(goods, market), new Proxy(goods, new Stall("h" + turn))]) {
      const line = [];
      for (const word of words) {
        try { line.push(show(p[word])); } catch (e) { line.push(e.name); }
        try { line.push(word in p); } catch (e) { line.push(e.name); }
      }
      line.push(show(p.bread), show(p.open), show(p["price of salt"]), show(p.a), show(p.b), show(p.first), "a" in p, "everything" in p, "two" in p);
      for (const word of ["a", "sign", "door", "lock", "d", "0"]) { try { p[word] = turn; } catch (e) { line.push(e.name); } }
      console.log(line.join(), log.splice(0).join());
    }
  }
  if (turn === 1) { morning.get = function (goods, word) { return word === "a" ? "replaced" : goods[word]; }; delete morning.has; night.get = undefined; Stall.prototype.get = (goods, word) => "late " + String(typeof word); }
}
