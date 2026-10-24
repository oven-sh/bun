// `const out: Shape[] = []` and a store by index right behind it: the array is born for objects, whatever is stored and wherever.
interface Shape { a: number }
const outside: any = JSON.parse('{"number":1.5,"whole":3,"text":"t","nothing":null,"index":2,"far":70000}');

function first(shape: Shape): Shape[] { const out: Shape[] = []; out[0] = shape; return out; }
function second(shape: Shape): Shape[] { const out: Shape[] = []; out[1] = shape; return out; }
function at(shape: Shape, index: number): Shape[] { const out: Shape[] = []; out[index] = shape; return out; }
function whateverArrives(value: any): Shape[] { const out: Shape[] = []; out[0] = value; out[1] = value; return out; }
function strings(text: string): string[] { const out: string[] = []; out[0] = text; out[2] = text; return out; }
function readsAtOnce(shape: Shape): unknown { const out: Shape[] = []; const nothing = out[0]; out[0] = shape; return [nothing, out[0] === shape, out.length]; }
function neverLeaves(shape: Shape): number { const out: Shape[] = []; out[0] = shape; out[1] = shape; return out[0].a + out[1].a + out.length; }
function pushedThenStored(shape: Shape): Shape[] { const out: Shape[] = []; out.push(shape); out[0] = { a: shape.a + 1 }; out[1] = shape; return out; }
function frozenFirst(shape: Shape): string { "use strict"; const out: Shape[] = []; Object.freeze(out); try { out[0] = shape; return "stored"; } catch (error) { return (error as Error).constructor.name; } }

const text = (value: unknown) => JSON.stringify(value) + " " + (Array.isArray(value) ? value.length + " " + Object.keys(value).join() : "");
for (let round = 0; round < 300; round++) {
  const shape = { a: round };
  const lines = [text(first(shape)), text(second(shape)), text(at(shape, outside.index)), text(at(shape, -1)), text(at(shape, outside.number)), at(shape, outside.far).length,
    text(whateverArrives(outside.number)), text(whateverArrives(outside.whole)), text(whateverArrives(outside.text)), text(whateverArrives(outside.nothing)), text(whateverArrives(undefined)),
    text(strings(outside.text)), text(readsAtOnce(shape)), neverLeaves(shape), text(pushedThenStored(shape)), frozenFirst(shape)];
  if (round % 100 === 0) console.log(lines.join("\n"));
}
