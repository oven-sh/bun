// Items kept by name in an object, added, taken, with errors as values
class Inventory {
  items = {};
  add(name, n, price) {
    const item = (this.items[name] ??= { n: 0, price });
    item.n += n;
    item.price = price ?? item.price;
    return this;
  }
  take(name, n) {
    const item = this.items[name];
    if (!item) return { ok: false, why: "no " + name };
    if (item.n < n) return { ok: false, why: "only " + item.n };
    item.n -= n;
    if (item.n === 0) delete this.items[name];
    return { ok: true, cost: n * item.price };
  }
}
function trade(n) {
  const store = new Inventory().add("a", n, 2).add("b", 5, 10).add("a", 1);
  const results = [store.take("a", 2), store.take("b", 5), store.take("b", 1), store.take("a", 100)];
  return results.map(result => (result.ok ? result.cost : result.why)).join() + " " + JSON.stringify(store.items);
}
console.log(trade(3));
console.log(trade(1));
console.log(trade(50));
