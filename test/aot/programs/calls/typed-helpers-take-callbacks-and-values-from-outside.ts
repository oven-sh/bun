// A typed helper that calls its callback is called with a function that the caller knows and a list of which the caller has proven nothing: the tests of the list stand between the two.
// The helper does what it does under `bun run` for a list that fits its type and for whatever else arrives.
const outside: any = JSON.parse('{"numbers":[1,2,3,4,5,6,7,8,9],"mixed":[1,"two",null,4.5],"text":"abc","like":{"length":2,"0":7,"1":8},"empty":[]}');

function each(xs: number[], f: (x: number, index: number) => void): void {
  let i = 0;
  for (; i + 3 < xs.length; i += 4) {
    f(xs[i], i); f(xs[i + 1], i + 1); f(xs[i + 2], i + 2); f(xs[i + 3], i + 3);
  }
  for (; i < xs.length; i++) f(xs[i], i);
  for (let j = xs.length - 1; j >= 0; j -= 2) f(xs[j], -j);
  for (let j = 0; j < xs.length; j += 3) f(xs[j], j * 10);
  for (let j = xs.length - 1; j >= 0; j -= 4) f(xs[j], -j * 10);
}
function sumOf(list: any): unknown {
  let sum: any = 0;
  each(list, x => { sum += x; });
  return sum;
}
function positionsOf(list: any): string {
  const seen: number[] = [];
  each(list, (_, index) => { seen.push(index); });
  return seen.join();
}
function stopsAt(list: any, limit: number): string {
  let count = 0;
  try {
    each(list, x => { if (++count === limit) throw new RangeError("stopped at " + String(x)); });
  } catch (error) {
    return (error as Error).message;
  }
  return "went through " + count;
}
function growsTheList(list: any): number {
  let calls = 0;
  each(list, () => { if (++calls < 4) list.push(calls); });
  return calls;
}
function passesWhatItWasGiven(list: any, f: any): string {
  try { each(list, f); return "returned"; } catch (error) { return (error as Error).constructor.name; }
}

for (let round = 0; round < 3; round++) {
  for (const name of ["numbers", "mixed", "text", "like", "empty"]) {
    const list = outside[name];
    console.log(round, name, String(sumOf(list)), positionsOf(list), stopsAt(list, 3));
  }
}
console.log(growsTheList([1, 2]), growsTheList(JSON.parse("[5]")));
console.log(passesWhatItWasGiven(outside.numbers, undefined), passesWhatItWasGiven(outside.empty, undefined), passesWhatItWasGiven(outside.numbers, Math.abs), passesWhatItWasGiven(null, () => {}));
