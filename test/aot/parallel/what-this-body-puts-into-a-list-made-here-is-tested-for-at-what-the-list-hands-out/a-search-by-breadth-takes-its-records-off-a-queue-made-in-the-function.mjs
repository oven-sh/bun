// a queue made in the function holds records that the function itself makes; each is taken off by shift and read by its names
const pairs = JSON.parse("[[0,1],[1,4],[2,7],[3,2],[4,5],[5,0],[6,3],[7,6],[0,5],[1,6],[2,3]]");
class Roads {
  #ways = new Map();
  join(a, b) { for (const [x, y] of [[a, b], [b, a]]) { const list = this.#ways.get(x); if (list) list.push(y); else this.#ways.set(x, [y]); } return this; }
  hops(from, to) {
    const seen = new Set([from]);
    const queue = [{ town: from, count: 0 }];
    while (queue.length) {
      const { town, count } = queue.shift();
      if (town === to) return count;
      for (const next of this.#ways.get(town) ?? []) if (!seen.has(next)) { seen.add(next); queue.push({ town: next, count: count + 1 }); }
    }
    return -1;
  }
}
const roads = pairs.reduce((all, [a, b]) => all.join(a, b), new Roads());
let sum = 17;
for (let t = 0; t < 400; ++t) sum = (Math.imul(sum, 31) + roads.hops(t & 7, (t * 3 + 1) & 7) * 100 + roads.hops((t + 1) & 7, 9)) | 0;
console.log(sum);
