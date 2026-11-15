const said: unknown[] = [];
const show = (v: unknown) => (Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));
function run(list: string[]): void { for (let round = 0; round < 2; round++) {
  list.forEach(function (this: unknown, x, i, whole) { said.push(this === undefined ? "no this" : (this as { tag: string }).tag, x, i, whole === list, arguments.length); }, round ? { tag: "given" } : undefined);
  try { list.map((x, i) => { if (i === 1) throw new RangeError("at " + x); return x; }); } catch (error) { said.push((error as Error).message); }
  try { ([] as number[]).reduce((a, x) => a + x); } catch (error) { said.push((error as Error).constructor.name); }
  try { list.filter(undefined as never); } catch (error) { said.push((error as Error).constructor.name); }
  said.push(list.find((x, i) => { said.push("asked " + i); return x === "b"; }), list.findIndex(x => x === "zz"), list.some(x => x === "a"), list.every(x => x === "a"));
} }
for (let turn = 0; turn < 300; turn++) { said.length = 0; run(["a", "b", "c"]); }
console.log(said.map(show).join(" "));
