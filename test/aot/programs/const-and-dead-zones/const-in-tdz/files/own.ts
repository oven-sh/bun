function probe(f: () => unknown): string { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } }
function hoisted(): number { return LIMIT * 2; }
export const before: string = probe(hoisted);
const LIMIT = 21;
export const after: string = probe(hoisted);
function inner(): string {
  const read = () => local;
  const first = probe(read);
  const local = "set";
  return first + " " + probe(read);
}
export const inAFunction: string = inner();
