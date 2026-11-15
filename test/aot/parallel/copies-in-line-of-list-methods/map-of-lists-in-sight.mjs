const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
for (let i = 0; i < 400; i++) { said.length = 0; const whole = [i, i + 1, i + 2], halves = [i + 0.5, i + 1.5], rows = [{ id: i }, { id: i + 1 }]; said.push(show(whole.map((v) => v * 2)), show(whole.map((v) => v + 0.25)), show(whole.map((v) => ({ v }))), show(whole.map((v) => "t" + v)), show(halves.map((v) => v | 0)), show(halves.map((v) => [v])), show(rows.map((r) => r.id)), show(whole.map((v, k) => (k === 1 ? "mid" : k === 2 ? 0.5 : v)))); }
console.log(said.join("\n"));
