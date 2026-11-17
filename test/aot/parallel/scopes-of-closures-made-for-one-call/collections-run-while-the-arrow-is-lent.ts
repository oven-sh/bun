const kept: Array<() => number> = [];
function churn(f: (text: string) => void): void { for (let i = 0; i < 3; i++) { const text = "t" + i + Math.random().toString(36).length; Bun.gc(true); f(text.slice(0, 2)); } }
function maker(start: number, keep: boolean): number {
  let held = { text: "s" + start };
  if (start < 100) churn(text => { held = { text: held.text + text }; });
  if (keep) kept.push(() => start);
  return held.text.length;
}

const first = maker(10, true);
console.log(maker(20, false));
console.log(maker(30, false));
const second = maker(40, true);
console.log(maker(50, false));
for (let turn = 0; turn < 200; turn++) maker(1000 + turn, false);
console.log(first, second, kept.map(f => f()).join(" "));
