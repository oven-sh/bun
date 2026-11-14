// flatMap whose callbacks answer arrays of up to five elements, written, kept, with holes, of each kind of storage.
const show = (list: any[]): string => "[" + Array.from({ length: list.length }, (_, k) => (k in list ? (Array.isArray(list[k]) ? show(list[k]) : Object.is(list[k], -0) ? "-0" : String(list[k])) : "hole")).join() + "]";
const whole: number[] = [], halves: number[] = [], words: string[] = []; for (let k = 0; k < 14; k++) { whole.push(k - 3); halves.push(k * 0.5); words.push("w" + k); }
const kept: any[][] = []; for (let k = 0; k < 14; k++) { const row: any[] = []; for (let i = 0; i < k % 6; i++) row.push(k % 3 === 0 ? i : k % 3 === 1 ? i * 0.5 : "r" + i); kept.push(row); }
const holed: any[][] = [[], [,], [1, ,], [, 2], [1, , 3], [, , 3], [1, 2, ,], [1, 2, , 4], [, 2, 3], [1, 2, 3], [0.5, , 1.5], ["a", , "c"], [1, 2, 3, 4, 5]];
class Sub extends Array<any> { } const sub = Sub.from([1, 2, 3]), proxied: any[] = [new Proxy([1, 2, 3], {}), new Proxy([], {})];
let turns = 0;
for (let round = 0; round < 60; round++) {
  const answers: any[][] = [
    whole.flatMap(x => [x, x + 1, x + 2]), whole.flatMap(x => [x, "t", x * 0.5]), halves.flatMap(x => [x, -x, x * 2]), words.flatMap(w => [w, w.length, null]), whole.flatMap(x => [x, x, x, x]), whole.flatMap(x => [x, x, x, x, x]), whole.flatMap((x, k) => (k % 4 === 0 ? [] : k % 4 === 1 ? [x] : k % 4 === 2 ? [x, k] : [x, k, round])),
    whole.flatMap((x, k) => kept[k]), whole.flatMap(x => [[x, 1], [x, 2], [x, 3]]), words.flatMap(w => w.split("")), whole.flatMap((x, k) => holed[k % holed.length]), whole.flatMap(x => (x % 2 ? x : [x, , x])), whole.flatMap(() => sub as any[]), whole.flatMap((x, k) => proxied[k & 1]), whole.flatMap(x => [, x, x]), words.flatMap(w => [w, undefined, w]), whole.flatMap(x => [x, 0.5, x]), halves.flatMap(x => [x, x | 0, "e"]),
  ];
  for (const answer of answers) turns += answer.length;
  if (round === 0 || round === 59) for (const answer of answers) console.log(show(answer));
}
const shrinking = [1, 2, 3, 4, 5, 6]; console.log(show(shrinking.flatMap(x => { if (x === 2) shrinking.length = 4; return [x, x, x]; })));
try { whole.flatMap(x => { if (x === 4) throw new Error("stop " + x); return [x, x, x]; }); } catch (error: any) { console.log(error.message); }
const taken: any[][] = []; const out = whole.flatMap(x => { const made = [x, x + 0.5, "m"]; taken.push(made); return made; }); taken[0][0] = "changed"; console.log(show(out.slice(0, 4)), show(taken[0]), turns);
