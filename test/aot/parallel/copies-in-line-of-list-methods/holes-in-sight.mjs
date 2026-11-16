const said = [];
const show = (list) => Array.from(list, (v) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join("|");
for (let i = 0; i < 400; i++) { said.length = 0; const holes = [i, , i + 2], wide = [0.5, , 2.5]; const made = holes.map((v) => v), other = wide.map((v) => v * 2); said.push(1 in made, made.length, show(holes.filter(() => true)), 1 in other, show(wide.filter(() => true)), JSON.stringify(made), JSON.stringify(other)); }
console.log(said.join("\n"));
