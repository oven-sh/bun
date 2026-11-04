function wholeProgram() {
interface Part { kind: number; flags: number; name: string; x?: object; y: number | undefined; z?: string; w?: Part }
interface Leaf extends Part { kind: 1; value: number }
interface Twig extends Part { kind: 2; text: string }
function Grower(this: Part, kind: number) { this.kind = kind; this.flags = 0; this.name = ""; this.x = undefined; this.y = undefined; this.z = undefined; this.w = undefined; }
function Sprout(this: any) { this.tall = 1; }
Object.setPrototypeOf(Sprout.prototype, Grower.prototype);
const Grow = Grower as unknown as new (kind: number) => Part;
function leaf(value: number): Leaf { const made = new Grow(1) as Leaf; made.value = value; return made; }
function twig(text: string): Twig { const made = new Grow(2) as Twig; made.text = text; return made; }
const make = (flags: number, name: string): Part => { const made: Part = flags & 1 ? leaf(flags) : twig(name); made.flags = flags; made.name = name; return made; };
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh");
console.log(Object.keys(other).join());
console.log(Object.keys(fresh).join());
console.log(new (Sprout as any)() instanceof Grower);
}
wholeProgram();
