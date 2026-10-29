// Array methods that take a callback, over an array with a hole. The callback gives the array a prototype that has an element at the index of the hole, so every method must visit the inherited element. Without the change the hole is skipped, or read as undefined by the find methods.
type List = any[];

function withHole(list: List): List {
  delete list[2];
  return list;
}

const kinds: [string, () => List, unknown][] = [
  ["int32", () => withHole([1, 2, 3, 4, 5]), 100],
  ["double", () => withHole([1.5, 2.5, 3.5, 4.5, 5.5]), 100.5],
  ["contiguous", () => withHole(["a", "b", "c", "d", "e"]), "inherited"],
];

function run(kind: string, create: () => List, inherited: unknown, changesPrototype: boolean): void {
  let visited: string[] = [];
  const visit = (list: List, element: unknown, index: number): void => {
    visited.push(`${index}:${element}`);
    if (changesPrototype && Object.getPrototypeOf(list) === Array.prototype) {
      Object.setPrototypeOf(list, Object.assign(Object.create(Array.prototype), { 2: inherited }));
    }
  };
  const report = (method: string, result: unknown): void => {
    console.log(`${kind}, ${changesPrototype ? "changed" : "unchanged"}, ${method}: ${JSON.stringify(result)} [${visited.join(" ")}]`);
    visited = [];
  };
  report("forEach", create().forEach((x, k, list) => visit(list, x, k)));
  report("map", create().map((x, k, list) => { visit(list, x, k); return x; }));
  report("filter", create().filter((x, k, list) => { visit(list, x, k); return true; }));
  report("some", create().some((x, k, list) => { visit(list, x, k); return false; }));
  report("every", create().every((x, k, list) => { visit(list, x, k); return true; }));
  report("find", create().find((x, k, list) => { visit(list, x, k); return false; }));
  report("findLast", create().findLast((x, k, list) => { visit(list, x, k); return false; }));
  report("findIndex", create().findIndex((x, k, list) => { visit(list, x, k); return false; }));
  report("findLastIndex", create().findLastIndex((x, k, list) => { visit(list, x, k); return false; }));
  report("reduce from a number", create().reduce((sum, x, k, list) => { visit(list, x, k); return sum + x; }, 0));
  report("reduce from a string", create().reduce((text, x, k, list) => { visit(list, x, k); return text + x; }, ""));
  report("reduce from the first element", create().reduce((first, x, k, list) => { visit(list, x, k); return first; }));
  report("reduceRight from a number", create().reduceRight((sum, x, k, list) => { visit(list, x, k); return sum + x; }, 0));
  report("reduceRight from a string", create().reduceRight((text, x, k, list) => { visit(list, x, k); return text + x; }, ""));
  report("reduceRight from the last element", create().reduceRight((last, x, k, list) => { visit(list, x, k); return last; }));
  report("flatMap", create().flatMap((x, k, list) => { visit(list, x, k); return [x, k]; }));
}

for (const [kind, create, inherited] of kinds) {
  run(kind, create, inherited, false);
  run(kind, create, inherited, true);
}
