// `const [first, ...rest] = parts` on lists that were parsed: the rest of a list of one is empty.
const MANY = "many";
function head(parts: string[]): string {
  const [first, ...rest] = parts;
  if (first !== undefined && rest.length === 0) return first;
  return MANY;
}
console.log(head(JSON.parse(process.argv.length > 5 ? "[]" : "[\"a\"]")), head(JSON.parse("[\"a\",\"b\"]")));
