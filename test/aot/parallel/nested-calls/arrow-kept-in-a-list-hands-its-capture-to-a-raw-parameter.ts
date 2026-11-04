interface Item { flags: number; parts?: Item[] }
const kept: Array<(t: Item) => boolean> = [];
function some(list: Item[], test: (t: Item) => boolean): boolean { kept.push(test); for (let i = 0; i < list.length; i++) if (kept[kept.length - 1](list[i])) return true; return false; }
function make() {
  let calls = 0;
  return { check, count: () => calls };
  function check(t: Item, kind: number): boolean { return has(t, kind); }
  function has(t: Item, k: number): boolean { calls++; return (t.flags & k) !== 0 || (t.parts !== undefined && some(t.parts, p => has(p, k))); }
}
const m = make();
console.log(m.check({ flags: 1, parts: [{ flags: 2 }, { flags: 8, parts: [{ flags: 4 }] }] }, 4), m.check({ flags: 1, parts: [{ flags: 2 }] }, 16), m.count(), some([{ flags: 3 }], t => t.flags === 3));
