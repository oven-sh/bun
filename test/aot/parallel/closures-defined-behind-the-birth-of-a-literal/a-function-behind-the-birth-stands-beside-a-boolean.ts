export {};
interface Dial { on: boolean; a: () => number; b: () => number; c: () => number; d: () => number; e: () => number; f: () => number; g: () => number; h: () => number; i: () => number; j: () => number; }
abstract class Fixed implements Dial { on = true; abstract a: () => number; abstract b: () => number; abstract c: () => number; abstract d: () => number; abstract e: () => number; abstract f: () => number; abstract g: () => number; abstract h: () => number; abstract i: () => number; abstract j: () => number; }
const kept: (() => number)[] = [];
function make(start: number, on: boolean): Dial {
  let at = start;
  let keep: () => number;
  const dial: Dial = { on, a: () => ++at, b: () => at + 2, c: () => at + 3, d: () => at + 4, e: () => at + 5, f: () => at + 6, g: () => at + 7, h: () => at + 8, i: ((keep = () => at * 3), () => at + 9), j: () => at + 10 };
  kept.push(keep);
  return dial;
}
const raw: any[] = JSON.parse(process.argv[2] ?? '[true,0,false,1]');
for (let t = 0; t < raw.length; t++) {
  const dial = make(t * 10, raw[t]);
  const last = kept[kept.length - 1]!;
  console.log(dial.a(), dial.i(), last(), dial.i === last, String(dial.on), Object.keys(dial).join(""), dial instanceof Fixed);
}
