// The digits of a number are computed in front of the loops that do not change it: for every number, zero and the others of one digit among them, which are written another way.
// Somebody may have replaced JSON.parse, so it is called with a string that is built here.
{ const somebody: any = (globalThis as any)[JSON.parse("\"somebody\"")] ?? {}; somebody[JSON.parse("\"something\"")] = 1; Object.defineProperty(somebody, JSON.parse("\"other\""), { get() { return 1; }, configurable: true }); }
const special = ["a", "b"];
let sum = 0;
for (let length = 0; length <= 12; length++) {
  for (const character of special) {
    for (const at of new Set([0, 1, length >> 1, length - 2, length - 1])) {
      if (at < 0 || at >= length) continue;
      const source = "{\"id\":" + length + ",\"label\":\"" + character + "\"}";
      const row = JSON.parse(source);
      sum += source.length + row.id;
    }
  }
}
console.log(sum);
for (const id of [0, 1, 9, 10, 99, 100, 1000, 54321, 999999, 1000000, 99999999, 100000000, 2147483647]) {
  let texts = "";
  for (const character of special) {
    for (const at of new Set([0, id & 1, 2])) {
      const source = "{\"id\":" + id + ",\"label\":\"" + character + at + "\"}";
      if (JSON.parse(source).id === id) texts += source;
    }
  }
  console.log(texts);
}
