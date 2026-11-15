// Functions with `...rest` behind none, one, two, four and six parameters, entered by value with every count of arguments from none to forty, and with lists spread that pass every size of a short list.
type Taker = (...given: unknown[]) => string;
function tell(rest: unknown[]): string {
  let sum = 0;
  for (let i = 0; i < rest.length; i++) sum = (sum * 31 + (rest[i] as number)) % 1000003;
  return rest.length + ":" + sum + ":" + Array.isArray(rest) + ":" + (rest.length in rest) + ":" + Object.keys(rest).length;
}
function none(...rest: unknown[]) { return tell(rest); }
function one(a: unknown, ...rest: unknown[]) { return a + "|" + tell(rest); }
function two(a: unknown, b: unknown, ...rest: unknown[]) { return a + "|" + b + "|" + tell(rest); }
function four(a: unknown, b: unknown, c: unknown, d: unknown, ...rest: unknown[]) { return a + "|" + b + "|" + c + "|" + d + "|" + tell(rest); }
function six(a: unknown, b: unknown, c: unknown, d: unknown, e: unknown, f: unknown, ...rest: unknown[]) { return a + "|" + b + "|" + c + "|" + d + "|" + e + "|" + f + "|" + tell(rest); }
const takers: Taker[] = [none, one, two, four, six];
const said: string[] = [];
for (let turn = 0; turn < 4; turn++) {
  said.length = 0;
  for (const taker of takers) {
    const given: number[] = [];
    for (let count = 0; count <= 40; count++) { said.push(taker(...given)); given.push(count + 1); }
    for (const count of [62, 63, 64, 65, 126, 127, 128, 129, 254, 255, 256, 257, 258, 511, 512, 513, 1000, 5000, 20000]) {
      const long: number[] = [];
      for (let i = 0; i < count; i++) long.push(i);
      said.push(taker(...long));
    }
  }
}
console.log(said.join("\n"));
