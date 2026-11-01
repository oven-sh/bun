// Todo: what stands between Object.create and the first store runs before the TypeError. The engine's fix is oven-sh/WebKit#984: the line goes out with the WebKit version that has it.
// In typed code too, Object.create(x) throws for an x that is no object before the call behind it runs: the type of a parameter is no proof.
interface Sized {
  items: number;
  readonly size: number;
}
const members = {
  get size(): number {
    return (this as unknown as Sized).items;
  },
};
function g(): number {
  console.log("g ran");
  return 7;
}
function make(proto: object | null): Sized {
  const made: Sized = Object.create(proto);
  made.items = g();
  return made;
}
console.log(make(members).size);
try {
  make(1 as unknown as object);
  console.log("no throw");
} catch (e) {
  console.log((e as Error).constructor.name, (e as Error).message);
}
