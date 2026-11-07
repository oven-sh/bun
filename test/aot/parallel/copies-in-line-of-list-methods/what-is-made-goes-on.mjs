const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
for (let i = 0; i < 400; i++) { said.length = 0; const whole = [i, i + 1, i + 2]; const kept = whole.filter((v) => v !== i); kept.push("text", 1.5, null); kept[8] = i; said.push(show(kept), kept.length); const made = whole.map((v) => v); made.length = 1; made.push({ i }); made.unshift(-0); said.push(show(made)); }
console.log(said.join("\n"));
