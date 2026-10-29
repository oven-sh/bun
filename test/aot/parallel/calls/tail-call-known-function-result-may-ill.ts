// `outer` ends in a call of one function that is known by its name. `inner` may return the very value that its own check of `list` has turned away, so its result
// is proven only where nothing ill-typed arrives. Untyped code passes both well-typed and ill-typed values.
function inner(list: string[], extra: number): string[] {
  if (extra > 0) list = list.concat(String(extra));
  return list;
}
function outer(list: string[], extra: number): string[] {
  return inner(list, extra);
}
function lengthOf(list: string[]): number {
  return outer(list, 1).length + outer(list, 0).length;
}
const untyped: any = outer;
const results: unknown[] = [];
for (let i = 0; i < 50; i++) results.push(lengthOf(["a", "b"]));
results.push(untyped(["x"], 2), untyped("not a list", 0), untyped(7, 0), untyped(undefined, 0), untyped({ length: 3 }, 0));
console.log(JSON.stringify(results.slice(48)));
