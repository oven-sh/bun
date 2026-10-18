// Declared keys are written again and again in one object, up to a hundred times, between other declared and undeclared keys: more entries than the word that remembers the order of the keys of a small type can hold.
type R1 = { m0: number };
type R2 = { m0: number; m1: number };
type R3 = { m0: number; m1: number; m2: number };
type R5 = { m0: number; m1: number; m2: number; m3: number; m4: number };
type R12 = { m0: number; m1: number; m2: number; m3: number; m4: number; m5: number; m6: number; m7: number; m8: number; m9: number; m10: number; m11: number };
type R13 = { m0: number; m1: number; m2: number; m3: number; m4: number; m5: number; m6: number; m7: number; m8: number; m9: number; m10: number; m11: number; m12: number };
type R14 = { m0: number; m1: number; m2: number; m3: number; m4: number; m5: number; m6: number; m7: number; m8: number; m9: number; m10: number; m11: number; m12: number; m13: number };
const plainParse: (text: string) => any = JSON.parse;
let seed = 3;
function below(limit: number): number {
  seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
  return (seed >>> 8) % limit;
}
function check(width: number, parse: (text: string) => unknown): void {
  let different = 0;
  let texts = 0;
  for (const repeats of [0, 1, 2, 3, 10, 11, 12, 13, 14, 15, 16, 17, 18, 30, 31, 32, 33, 63, 64, 65, 100]) {
    for (let turn = 0; turn < 12; turn++) {
      const members: string[] = [];
      for (let at = 0; at < width; at++) members.push('"m' + at + '":' + at);
      for (let count = 0; count < repeats; count++) members.splice(below(members.length + 1), 0, '"m' + (turn % 3 ? below(width) : turn % width) + '":' + (100 + count));
      if (turn % 4 === 1) for (let count = 0; count < 1 + below(4); count++) members.splice(below(members.length + 1), 0, '"u' + below(3) + '":' + count);
      if (turn % 4 === 3) members.reverse();
      const text = "{" + members.join(",") + "}";
      for (let round = 0; round < 3; round++) {
        texts++;
        const typed: any = parse(text);
        const plain = plainParse(text);
        if (JSON.stringify(typed) !== JSON.stringify(plain) || Object.keys(typed).join() !== Object.keys(plain).join()) different++;
      }
    }
  }
  console.log(width + " members: " + texts + " texts: " + different + " differ");
}
check(1, text => JSON.parse<R1>(text));
check(2, text => JSON.parse<R2>(text));
check(3, text => JSON.parse<R3>(text));
check(5, text => JSON.parse<R5>(text));
check(12, text => JSON.parse<R12>(text));
check(13, text => JSON.parse<R13>(text));
check(14, text => JSON.parse<R14>(text));
