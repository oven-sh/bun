// `new` of a constructor that is read from a global calls a host constructor: the site has no inline paths for callees that are compiled functions.
// CALLS- constructsInLoop ConstructClosure
// CALLS+ constructsValueInLoop ConstructClosure
export function constructsInLoop(texts: string[]): number {
  let made = 0;
  for (const text of texts) if (new Function(text)) made++;
  return made;
}
export function constructsValueInLoop(constructors: (new () => object)[]): number {
  let made = 0;
  for (const constructor of constructors) if (new constructor()) made++;
  return made;
}
class Local { v = 1; }
const table: Record<string, Function> = { constructsInLoop, constructsValueInLoop };
console.log(table.constructsInLoop([]), table.constructsValueInLoop([Local, Object, Map]));
