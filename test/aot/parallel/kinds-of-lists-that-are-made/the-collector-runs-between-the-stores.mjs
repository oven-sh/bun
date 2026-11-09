function pushed(n, f) { const made = []; for (let k = 0; k < n; k++) made.push(f(k)); return made; }
const whole = pushed(24, (k) => k);
const kept = [];
let total = 0;
for (let turn = 0; turn < 3000; turn++) {
  const made = whole.map((v, k) => {
    if ((turn & 127) === 0 && (k === 0 || k === 1 || k === 13)) Bun.gc(true);
    return k === 0 && (turn & 1) ? v : { v, text: "t" + turn + "-" + k, list: [v, turn] };
  });
  if ((turn & 255) === 0) kept.push(made);
  for (let k = 1; k < made.length; k++) total += made[k].v + made[k].text.length + made[k].list[1];
}
Bun.gc(true);
for (const made of kept) for (let k = 1; k < made.length; k++) total += made[k].list[0] + made[k].text.length;
console.log(total, kept.length);
