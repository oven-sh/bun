// A source that reuses its variables declares a parameter with a union and hands it on with a cast. All that such a body does with the value at its entrance is to check it for one type,
// and the compiler then tests for that type at the entrance. Every call here has to answer as it does without types: a cast does nothing at run time.
class Root {
  name = "root";
  size = 1;
}
class Leaf {
  name = "leaf";
  weight = 2.5;
}

function lengthOf(text: string): number {
  return text.length;
}
function nameOf(root: Root): string {
  return root.name + ":" + root.size;
}

function handsOn(value: string | number | boolean, twice: boolean): number {
  if (twice) return lengthOf(value as string) * 2;
  return lengthOf(value as string);
}
function handsOnObject(value: Root | Leaf | null): string {
  return nameOf(value as Root);
}
function reassigned(value: string | number): number {
  value = String(value) + "!";
  return lengthOf(value as string);
}
function reassignedOnOnePath(value: string | number, other: boolean): number {
  if (other) value = "other";
  return lengthOf(value as string);
}
function withDefault(value: string | number = "default"): number {
  return lengthOf(value as string);
}
function writesItsArguments(value: string | number): number {
  arguments[0] = "written";
  return lengthOf(value as string) + lengthOf(arguments[0] as string);
}
function changesHalfway(value: string | number, depth: number): number {
  if (depth === 0) return lengthOf(value as string);
  return changesHalfway(depth === 2 ? 42 : value, depth - 1);
}
function castOnOnePath(value: string | number, casts: boolean): number {
  if (casts) return lengthOf(value as string);
  return -1;
}
function downTheTree(root: Root | Leaf | string, depth: number): string {
  if (depth === 0) return nameOf(root as Root);
  return acrossTheTree(root as Root, depth - 1);
}
function acrossTheTree(root: Root, depth: number): string {
  return downTheTree(root, depth);
}
function captured(value: string | number): () => number {
  return () => lengthOf(value as string);
}

const out: unknown[] = [];
const show = (label: string, run: () => unknown) => {
  try {
    out.push(label + " " + String(run()));
  } catch (error) {
    out.push(label + " throws " + (error as Error).constructor.name);
  }
};
const byValue: Record<string, (...values: any[]) => unknown> = {
  handsOn, handsOnObject, reassigned, reassignedOnOnePath, withDefault, writesItsArguments, changesHalfway, castOnOnePath, downTheTree, captured,
};

show("string", () => handsOn("four", false) + handsOn("four", true));
show("number by value", () => byValue.handsOn!(7, false));
show("boolean by value", () => byValue.handsOn!(true, true));
show("undefined by value", () => byValue.handsOn!(undefined, false));
show("object with a length by value", () => byValue.handsOn!({ length: 9 }, true));
show("no argument", () => byValue.handsOn!());
show("root", () => handsOnObject(new Root()));
show("leaf by value", () => byValue.handsOnObject!(new Leaf()));
show("null", () => handsOnObject(null));
show("literal by value", () => byValue.handsOnObject!({ name: "made", size: 3 }));
show("reassigned", () => reassigned(12345) + reassigned("ab"));
show("reassigned on one path", () => [reassignedOnOnePath(5, true), reassignedOnOnePath("abc", false), byValue.reassignedOnOnePath!(5, false)].join());
show("default", () => [withDefault(), withDefault(undefined), withDefault("a"), byValue.withDefault!(7), byValue.withDefault!(null) === undefined].join());
show("default of null", () => byValue.withDefault!(null));
show("arguments", () => [writesItsArguments("ab"), byValue.writesItsArguments!(3)].join());
show("halfway", () => [changesHalfway("abc", 1), changesHalfway("abc", 3), changesHalfway("abc", 0)].join());
show("one path", () => [castOnOnePath(5, false), castOnOnePath("ab", true), byValue.castOnOnePath!(5, true)].join());
show("tree", () => [downTheTree(new Root(), 6), byValue.downTheTree!(new Leaf(), 3), byValue.downTheTree!("text", 2)].join());
show("captured", () => [captured("abcd")(), (byValue.captured!(6) as () => unknown)()].join());

let sum = 0;
const values: any[] = ["a", "bb", "ccc", 4, "eeeee", true, { length: 100 }, "h"];
for (let round = 0; round < 20000; round++) {
  const answer = byValue.handsOn!(values[round & 7], (round & 8) === 0);
  if (typeof answer === "number" && answer === answer) sum += answer;
  sum += handsOn("xyz", false);
  if ((round & 1023) === 0) sum += (downTheTree(new Root(), round & 15) as string).length;
}
out.push("sum " + sum);
console.log(out.join("\n"));
