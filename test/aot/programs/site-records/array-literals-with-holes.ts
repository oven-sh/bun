// Array literals with holes at the start, in the middle and at the end, of integers, fractions, texts and objects. A hole is no element: `in`, the listing of keys, callbacks, spreads, copies and the chain above the array tell it from undefined.
function show(list: unknown[]): string {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? (list[i] === undefined ? "undefined" : JSON.stringify(list[i])) : "hole");
  return list.length + " [" + parts.join() + "] keys " + Object.keys(list).join();
}

function holeInIntegers(): (number | undefined)[] {
  return [1, , 3];
}
function holeInFractions(): (number | undefined)[] {
  return [1.5, , 3.5];
}
function holeInTexts(): (string | undefined)[] {
  return ["a", , "c"];
}
function holeInObjects(): (object | undefined)[] {
  return [{ a: 1 }, , [3]];
}
function holeInMixed(seed: unknown): unknown[] {
  return [seed, , 1, , "x", , null, , undefined, , 2.5];
}
function holeFirst(): unknown[] {
  return [, 2, 3];
}
function holeLast(): unknown[] {
  return [1, 2, ,];
}
function onlyHoles(): unknown[] {
  return [, , ,];
}
function oneHole(): unknown[] {
  return [,];
}
function undefinedNotHole(): unknown[] {
  return [1, undefined, 3];
}
function spreadOfHoles(source: unknown[]): unknown[] {
  return [0, ...source, , ...source];
}
function nestedHoles(): unknown[][] {
  return [[, 1], , [1, ,]] as unknown[][];
}

function elementAt(list: unknown[], index: number): unknown {
  return list[index];
}
function secondOf(list: unknown[]): unknown {
  return list[1];
}
function look(mark: string, make: () => unknown[]): void {
  const list = make();
  console.log(mark + ":", show(list), "|", String(secondOf(list)), String(elementAt(list, 0)), String(elementAt(list, list.length - 1)), String(elementAt(list, list.length)));
  let visited = "";
  list.forEach((_each, index) => (visited += index));
  console.log("  forEach", visited, "| map", show(list.map(() => 1)), "| spread", show([...list]), "| slice", show(list.slice()), "| concat", show(list.concat([, 1])));
  console.log("  join", list.map(each => (typeof each === "object" ? "o" : each)).join("-"), "| includes", list.includes(undefined), "| indexOf", list.indexOf(undefined), "| JSON", JSON.stringify(list), "| from", show(Array.from(list)));
  const filled = make();
  filled[1] = "filled";
  console.log("  filled", show(filled), "| another", show(make()), make() === make());
  const below = make();
  Object.setPrototypeOf(below, Object.assign(Object.create(Array.prototype), { 0: "above 0", 1: "above 1", 2: "above 2" }));
  console.log("  with elements above:", String(secondOf(below)), String(elementAt(below, 0)), String(elementAt(below, 2)), 1 in below, Object.hasOwn(below, 1), Array.isArray(below), below.length);
}

look("integers", holeInIntegers);
look("fractions", holeInFractions);
look("texts", holeInTexts);
look("objects", holeInObjects);
look("mixed", () => holeInMixed(7));
look("first", holeFirst);
look("last", holeLast);
look("only holes", onlyHoles);
look("one hole", oneHole);
look("undefined, no hole", undefinedNotHole);
look("spread of holes", () => spreadOfHoles(holeInIntegers()));
look("nested", nestedHoles);
look("integers", holeInIntegers);

const [first = "default first", second = "default second", third = "default third", fourth = "default fourth"] = holeInTexts();
console.log(first, second, third, fourth);
const grown = holeInIntegers();
grown[10] = 10;
grown.length = 12;
console.log(show(grown));
grown.length = 2;
console.log(show(grown), grown.pop(), grown.pop(), grown.pop(), show(grown));
delete (holeInIntegers() as any)[0];
const punched = undefinedNotHole();
delete punched[1];
console.log(show(punched), show(undefinedNotHole()));

export {};
