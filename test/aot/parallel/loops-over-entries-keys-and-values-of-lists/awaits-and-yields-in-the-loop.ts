const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
async function slow(list: number[]): Promise<number> { let sum = 0; for (const [i, x] of list.entries()) { sum += (await x) * i; if (i === 1) list.push(50); } return sum; }
function* steps(list: string[]): Generator<string> { for (const [i, x] of list.entries()) yield i + x; for (const i of list.keys()) yield "k" + i; }
for (let turn = 0; turn < 100; turn++) { said.length = 0; said.push(await slow([1, 2, 3]), [...steps(["a", "b"])]); const running = steps(["p", "q"]); said.push(running.next().value, running.return("r" as never).value, running.next().done); }
console.log(said.map(show).join(" "));
