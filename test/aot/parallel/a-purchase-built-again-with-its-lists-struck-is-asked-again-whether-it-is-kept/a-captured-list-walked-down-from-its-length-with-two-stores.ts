function show(...all: any[]): string { return all.map(one => (typeof one)[0] + (Object.is(one, -0) ? "-0" : String(one))).join(" "); }
function pushed(count: number): number[] { const made: number[] = []; for (let i = 0; i < count; i++) made.push((i * 5 + 3) & 7); return made; }
function make(a: number[]) { return function run(n: number, stop: number, mark: number): string { let s = 0, t = 0.5, x = 0, h = 0; for (let c = a.length - 1; c >= 0; c--) { a[c] = t; if (c + 1 < a.length) a[c + 1] = x; s = (s + a[c]) | 0; } return show(s, t, x, h, a[0], a.length); }; }
for (const [n, stop, mark] of JSON.parse("[[8, 0, 9], [5, 3, 1], [11, 99, 7], [0, 0, 3]]")) {
  const list: number[] = JSON.parse("[3, 1, 4, 1, 5, 9, 2, 6]");
  let said; try { said = make(list)(n, stop, mark); } catch { said = "threw"; }
  console.log(said + " | " + show(list.length) + " | " + show(...list));
}
export {};
