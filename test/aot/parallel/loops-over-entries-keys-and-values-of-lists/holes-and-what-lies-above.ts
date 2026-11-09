const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: unknown[]) { for (const [i, x] of list.entries()) said.push(i, x); for (const i of list.keys()) said.push(i); for (const x of list.values()) said.push(x); }
for (let turn = 0; turn < 300; turn++) { said.length = 0; run([1, , 3]); const sparse: unknown[] = []; sparse[3] = "d"; run(sparse); run(new Array(2)); run([0.5, , -0]); }
console.log(said.map(show).join(" "));
