// Objects that are given back and used again, with all fields reset
class Pool {
  free = [];
  made = 0;
  take(x) {
    const one = this.free.pop() ?? { id: ++this.made, x: 0, tags: [] };
    one.x = x;
    return one;
  }
  give(one) {
    one.tags.length = 0;
    delete one.extra;
    this.free.push(one);
  }
}
function run(rounds, n) {
  const pool = new Pool();
  const log = [];
  for (let i = 0; i < rounds; i++) {
    const list = [];
    for (let k = 0; k <= n; k++) list.push(pool.take(i * k));
    list[0].extra = i;
    list[n].tags.push(i);
    log.push(list.map(one => one.id + ":" + one.x + one.tags.length + (one.extra ?? "")).join("+"));
    list.forEach(one => pool.give(one));
  }
  return log.join(" ") + " " + pool.made + pool.free.length;
}
console.log(run(2, 1));
console.log(run(3, 2));
console.log(run(1, 0));
