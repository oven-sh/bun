export {};
interface Dial { on: boolean; a: () => number; b: () => number; c: () => number; d: () => number; e: () => number; f: () => number; g: () => number; h: () => number; i: () => number; j: () => number; }
abstract class Fixed implements Dial { on = true; abstract a: () => number; abstract b: () => number; abstract c: () => number; abstract d: () => number; abstract e: () => number; abstract f: () => number; abstract g: () => number; abstract h: () => number; abstract i: () => number; abstract j: () => number; }
const said: any[] = [];
function make(start: number, on: boolean): Dial {
  let at = start;
  let keep: (n: number) => string;
  const dial: Dial = { on, a: () => ++at, b: () => at + 2, c: () => at + 3, d: () => at + 4, e: () => at + 5, f: () => at + 6, g: () => at + 7, h: () => at + 8, i: ((keep = (n: number) => n + typeof on), () => at + 9), j: () => at + 10 };
  said.push([1, 2].map(keep).join());
  return dial;
}
const raw: any[] = JSON.parse(process.argv[2] ?? '[true,0,false,1]');
for (let t = 0; t < raw.length; t++) {
  const dial = make(t * 10, raw[t]);
  console.log(String(said[t]), dial.a(), dial.i(), String(dial.on), dial instanceof Fixed);
}
