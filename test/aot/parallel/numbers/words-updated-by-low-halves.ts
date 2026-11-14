const makers: (() => any[])[] = [() => Array.from({ length: 8 }, (_, k) => k), () => JSON.parse("[3, 2147483647, -7, 0.5, 4294967295, 11, 9007199254740991, -2147483648]"), () => [2147483647, 2147483640, -2147483648, 0, 1, 2, 3, 4], () => new Array(8).fill(4294967290)];
const words = new Int32Array(8), unsignedWords = new Uint32Array(8);
class Hash { word: any = 1; count: any = 0; mix(x: any, y: any) { this.word ^= x; this.count += y; this.word = (this.word - y) | 0; return this.word + x + y; } }
function subtractFromEach(list: any[], first: any, turns: any) {
  let last: any = first;
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < list.length; k++) list[k] = (list[k] - i) | 0;
    last = i;
  }
  return [last, list[turns & 7]].join();
}
function addInPlace(list: any[], first: any, turns: any, point: any, table: any) {
  let seen = 0, low = first | 0;
  for (let i = first; i < first + turns; i++) {
    for (let k = 0; k < 8; k++) {
      const amount = (i + k) | 0;
      words[k] += amount;
      unsignedWords[k] = (unsignedWords[k] ^ amount) >>> 0;
      table.counts[k] += amount;
      const sum = point.low + amount;
      if (sum <= 2147483647 && sum >= -2147483648) point.low = sum;
      else seen = (seen + sum) | 0;
      if (list[k] === amount) seen ^= amount;
      low = (low + amount) & 65535;
    }
    point.high += i;
    table.total = (table.total - i) | 0;
  }
  return [seen, low, point.low, point.high, table.total, table.counts.join()].join();
}
for (const make of makers) for (const first of [0, 5, -3, 2147483645, -2147483648, 4294967290]) for (const turns of [1, 3, 17]) {
  words.fill(0); unsignedWords.fill(4294967295);
  const list = make(), hash = new Hash();
  console.log(subtractFromEach(list, first, turns), list.join(), addInPlace(make(), first, turns, { low: first, high: 2 ** 31 }, { counts: make(), total: first }), words.join(), unsignedWords.join());
  for (const value of list) hash.mix(value, first);
  console.log(hash.mix(first, turns), hash.word, hash.count);
}
export {};
