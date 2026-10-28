// Each function iterates a String object in one call and a collection of numbers in another, and adds up what it gets.
function addWithForOf(items: any): unknown {
  let total: any = 0;
  for (const item of items) total += item;
  return total;
}
function addWithSpread(items: any): unknown {
  let total: any = 0;
  for (const item of [...items]) total += item;
  return total;
}
function addWithPattern(items: any): unknown {
  const [first, second] = items;
  return first + second;
}
function addWithArrayFrom(items: any): unknown {
  let total: any = 0;
  for (const item of Array.from(items) as any[]) total += item;
  return total;
}
function addArguments(...all: any[]): unknown {
  let total: any = 0;
  for (const item of all) total += item;
  return total;
}
function addWithCallSpread(items: any): unknown {
  return addArguments(...items);
}
function* passOn(items: any): Generator<any> {
  yield* items;
}
function addWithDelegation(items: any): unknown {
  let total: any = 0;
  for (const item of passOn(items)) total += item;
  return total;
}
function addThroughSet(items: any): unknown {
  let total: any = 0;
  for (const item of new Set(items)) total += item;
  return total;
}
async function addWithForAwait(items: any): Promise<unknown> {
  let total: any = 0;
  for await (const item of items) total += item;
  return total;
}
class Label extends String {}

const makers: [string, () => any][] = [
  ["String object", () => new String("ab")],
  ["Object(string)", () => Object("cd")],
  ["subclass of String", () => new Label("ef")],
  ["Set", () => new Set([1, 2])],
];
for (const [name, make] of makers) {
  console.log(name, addWithForOf(make()), addWithSpread(make()), addWithPattern(make()), addWithArrayFrom(make()), addWithCallSpread(make()), addWithDelegation(make()), addThroughSet(make()), await addWithForAwait(make()));
}

function addBesideMap(items: any): unknown {
  const [first, second] = items;
  return first + "|" + second;
}
console.log(addBesideMap(new String("gh")), addBesideMap(new Map([[1, 2], [3, 4]])));

function addBesideTypedArray(items: any): unknown {
  const [first, second] = items;
  return first + second;
}
console.log(addBesideTypedArray(new String("ij")), addBesideTypedArray(new Int32Array([1, 2])));

function addBesideArray(items: any): unknown {
  const [first, second] = items;
  return first + second;
}
console.log(addBesideArray(new String("kl")), addBesideArray([1, 2]));

function addBesideGenerator(items: any): unknown {
  const [first, second] = items;
  return first + second;
}
console.log(addBesideGenerator(new String("mn")), addBesideGenerator((function* () { yield 1; yield 2; })()));
