// Interfaces, unions told apart by a tag, and classes that implement them.
interface Cat {
  kind: "cat";
  lives: number;
}
interface Dog {
  kind: "dog";
  tricks: string[];
}
type Pet = Cat | Dog;
function describe(pet: Pet): string {
  if (pet.kind === "cat") return `cat with ${pet.lives} lives`;
  return `dog knowing ${pet.tricks.join(", ")}`;
}
const pets: Pet[] = [
  { kind: "cat", lives: 9 },
  { kind: "dog", tricks: ["sit", "roll"] },
];
console.log(pets.map(describe));
type Tree = { value: number; children: Tree[] };
function total(tree: Tree): number {
  let sum = tree.value;
  for (const child of tree.children) sum += total(child);
  return sum;
}
console.log(total({ value: 1, children: [{ value: 2, children: [] }, { value: 3, children: [{ value: 4, children: [] }] }] }));
function size(value: string | number[] | Map<string, number> | undefined): number {
  if (value === undefined) return -1;
  if (typeof value === "string") return value.length;
  if (Array.isArray(value)) return value.length;
  return value.size;
}
console.log(size("abc"), size([1]), size(new Map([["a", 1]])), size(undefined));
const tuple: [string, number, boolean?] = ["a", 1];
const record: Record<string, number> = { one: 1 };
record.two = 2;
console.log(tuple.length, record.two, record.three);
