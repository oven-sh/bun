// `const [first, ...rest] = parts` reads `parts` behind a test of its storage and appends to `rest`, a new array, in the same loop. A list of one element and a list of two go through it.
const MANY = "many";
function head(parts: string[]): string {
  const [first, ...rest] = parts;
  if (first !== undefined && rest.length === 0) return first;
  return MANY;
}
console.log(head(JSON.parse(process.argv.length > 5 ? "[]" : "[\"a\"]")), head(JSON.parse("[\"a\",\"b\"]")));
