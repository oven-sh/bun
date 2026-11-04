// A generator returns a literal of forty elements, each of them what a yield is sent, with holes between. It is run to its end twice, and left by return() and by throw() in the middle of the literal.
function* collect(tag: string): Generator<number, unknown[], unknown> {
  return [
    yield 1, yield 2, yield 3, , yield 4, yield 5, yield 6, yield 7, yield 8, yield 9, yield 10,
    yield 11, yield 12, yield 13, yield 14, yield 15, yield 16, yield 17, yield 18, yield 19, yield 20,
    tag, yield 21, yield 22, yield 23, yield 24, yield 25, yield 26, yield 27, yield 28, yield 29, yield 30,
    yield 31, yield 32, yield 33, yield 34, yield 35, , , yield 36, yield 37, yield 38, yield 39, yield 40,
  ];
}

function run(tag: string, make: (n: number) => unknown) {
  const g = collect(tag);
  let r = g.next();
  while (!r.done) r = g.next(make(r.value));
  return r.value;
}

const objects = run("a", n => ({ n }));
console.log(objects.length, JSON.stringify(objects[0]), 3 in objects, JSON.stringify(objects[4]), objects[21], 37 in objects, 38 in objects, JSON.stringify(objects[43]));
const numbers = run("b", n => n + 0.5);
console.log(numbers.length, numbers.join("|"));
console.log(objects === run("a", n => ({ n })));
const left = collect("c");
left.next(); left.next("x"); left.next("y");
console.log(JSON.stringify(left.return(["out"])), JSON.stringify(left.next()));
const hit = collect("d");
for (let i = 0; i < 25; i++) hit.next(i);
try { hit.throw(new RangeError("stop")); } catch (e) { console.log((e as Error).name, JSON.stringify(hit.next())); }
