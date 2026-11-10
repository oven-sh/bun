// STATISTIC: LoopsLaidOutOnceAKindThatAreComeBackTo >= 1
const out: number[] = [], o = { n: 0 };
let text = "", backs = 0, noted = 0;
function note(x: number): void { noted = (noted * 3 + x) | 0; if ((noted & 31) === 7) out.push(noted); }
function show(x: number): string { return Object.is(x, -0) ? "-0" : String(x); }
function run(list: number[], mark: number): string { let s = 0, h = 0, k = 0; for (let i = 0; i < list.length; i++) { const v = list[i]!; if (v === mark) { o.n = o.n + i; } s += v; } return show(s) + " " + h + " " + k; }
const makers: ((n: number, marked: (i: number) => boolean) => number[])[] = [
  (n, marked) => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(marked(i) ? 99 : i & 7); return l; },
  (n, marked) => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(marked(i) ? 99 : (i & 7) + 0.5); return l; },
  (n, marked) => { const l: number[] = new Array(n); for (let i = 0; i < n; i++) if (i % 11 !== 5) l[i] = marked(i) ? 99 : i & 7; return l; },
  (n, marked) => { const l: number[] = new Array(n); for (let i = 0; i < n; i++) if (i % 13 !== 6) l[i] = marked(i) ? 99 : (i & 7) + 0.25; return l; },
  (n, marked) => { const l: number[] = []; for (let i = 0; i < n; i++) l.push(marked(i) ? 99 : i === (n >> 1) ? 1.5 : 2147483000 + (i & 7)); return l; },
];
const marks: ((i: number) => boolean)[] = [() => false, i => i === 0, i => i === 1, i => i === 7, i => i === 8, i => i === 9, i => (i & 1) === 1, i => i % 3 === 0, i => i % 20 === 19, i => i % 100 === 50, i => i > 40 && i < 60, () => true];
for (const n of [0, 1, 7, 8, 9, 16, 17, 64, 65, 100, 600, 1300]) for (let maker = 0; maker < makers.length; maker++) for (let m = 0; m < marks.length; m++) {
  out.length = 0; o.n = 0; text = ""; backs = 0; noted = 0;
  const list = makers[maker]!(n, marks[m]!);
  const answer = run(list, 99);
  let x = 0; for (const v of out) x = (x * 31 + v) | 0;
  let y = 0; for (let i = 0; i < list.length; i++) y = (y * 7 + (i in list ? list[i]! * 4 : -1)) % 1000003;
  console.log(n, maker, m, answer, out.length, x, o.n, text.length, backs, noted, y);
}
