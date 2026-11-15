const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: (number | string)[]) { for (const [i, x] of list.entries()) said.push(i, x); for (const i of list.keys()) said.push(i); for (const x of list.values()) said.push(x); }
for (let turn = 0; turn < 300; turn++) { said.length = 0; run([turn, "a", 2.5]); run([]); run(JSON.parse('[1,"b"]')); }
console.log(said.map(show).join(" "));
