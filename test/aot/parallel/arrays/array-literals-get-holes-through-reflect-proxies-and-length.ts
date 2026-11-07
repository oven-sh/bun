const lines: string[] = [];
function show(label: string, list: Iterable<string | undefined>) {
  const seen: string[] = [];
  for (const each of list) seen.push(each === undefined ? "hole" : each.toUpperCase());
  lines.push(`${label}: ${seen.join(" ")}`);
}
function walk(label: string, list: string[]) {
  const seen: string[] = [];
  for (const each of list) seen.push(each === undefined ? "hole" : each.toUpperCase());
  lines.push(`${label}: ${seen.join(" ")}`);
}

const untouched = ["a", "b"];
walk("untouched", untouched);

const setByReflect = ["a", "b"];
Reflect.set(setByReflect, 3, "d");
walk("Reflect.set past the end", setByReflect);

const lengthByReflect = ["a", "b"];
Reflect.set(lengthByReflect, "length", 3);
walk("Reflect.set of length", lengthByReflect);

const lengthDefined = ["a", "b"];
Object.defineProperty(lengthDefined, "length", { value: 4 });
walk("length defined", lengthDefined);

const indexDefined = ["a", "b"];
Reflect.defineProperty(indexDefined, 3, { value: "d", writable: true, enumerable: true, configurable: true });
walk("index defined past the end", indexDefined);

const definedTogether = ["a", "b"];
Object.defineProperties(definedTogether, { 4: { value: "e", enumerable: true } });
walk("Object.defineProperties", definedTogether);

const lengthAssigned = ["a", "b"];
Object.assign(lengthAssigned, { length: 3 });
walk("length assigned", lengthAssigned);

const behindProxy = ["a", "b"];
new Proxy(behindProxy, {})[3] = "d";
walk("stored through a proxy", behindProxy);

const deletedThroughProxy = ["a", "b"];
delete new Proxy(deletedThroughProxy, {})[0];
walk("deleted through a proxy", deletedThroughProxy);

const storedByPattern = ["a", "b"];
[storedByPattern[3]] = ["d"];
walk("stored by a pattern", storedByPattern);

const storedByLoop = ["a", "b"];
for (storedByLoop[4] of ["e"]);
walk("stored by a loop head", storedByLoop);

const changedByComparator = ["b", "a", "c"];
changedByComparator.sort((left, right) => {
  changedByComparator.length = 5;
  return left < right ? -1 : 1;
});
walk("made longer by a comparator", changedByComparator);

const changedByCallback = ["a", "b"];
changedByCallback.forEach((each, index, list) => {
  if (!index) list[3] = each;
});
walk("stored by a callback", changedByCallback);

const borrowed = ["a", "b"];
Array.prototype.splice.call(borrowed, 1, 1);
borrowed.length = 3;
walk("spliced, then made longer", borrowed);

const copiedWithin = ["a", "b", "c"];
delete copiedWithin[2];
copiedWithin.copyWithin(0, 2);
walk("a hole copied within", copiedWithin);

const reversed = ["a", "b", "c"];
reversed.length = 4;
reversed.reverse();
walk("reversed", reversed);

const held = { list: ["a", "b"] };
const { list: alias } = held;
alias.length = 3;
walk("made longer under another name", held.list);

const nested = [["a", "b"]];
for (const inner of nested) inner[3] = "d";
walk("an inner list stored into", nested[0]);

function* handOut(list: string[]) {
  yield* list;
}
const delegated = ["a", "b"];
delegated[3] = "d";
show("yield*", handOut(delegated));

const keyed = ["a", "b"];
keyed[2 as number | string as string as unknown as number] = "c";
keyed["4" as unknown as number] = "e";
walk("stored under a text that is an index", keyed);

const later = ["a", "b"];
queueMicrotask(() => {
  later.length = 3;
});
await null;
walk("made longer by a job", later);

show("into a Map", new Map([["a", "x"], ["b", "y"]]).keys());
const pairs: string[][] = [["a", "x"], ["b", "y"]];
pairs[0].length = 1;
for (const [key, value] of new Map(pairs as [string, string][])) lines.push(`pair: ${key} ${value === undefined ? "hole" : value}`);

console.log(lines.join("\n"));
