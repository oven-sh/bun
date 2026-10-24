// Plain Bun inlines a `const` with a literal value that stands before every other statement of an enclosing scope, so an enum member in an inner scope that reads it is a constant, and one that reads a later `const` is not.
const leading = 5;
const leadingWord = "w";
declare const console: { log(...values: unknown[]): void };
function row(label: string, value: object) {
  console.log(label + ": " + Object.keys(value).map(key => key + "=" + String((value as any)[key])).join());
}
const trailing = 7;

function readsLeading() {
  enum E { A = leading, B, C = leadingWord, D = `${leadingWord}-d` }
  return E;
}
row("a leading constant", readsLeading());

function readsTrailing() {
  enum E { A = trailing, B }
  return E;
}
row("a later constant", readsTrailing());
