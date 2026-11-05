function bodyOfTheProgram() {
// One deed a program: the maker gives x, y, z and w the constant undefined, which makes them own properties in the order of the text, whether anything is ever stored there or not.
interface Base { kind: number; flags: number; name: string; x?: object; y: number | undefined; z?: string; w?: Base }
interface One extends Base { kind: 1; value: number }
interface Two extends Base { kind: 2; text: string }
function Maker(this: Base, kind: number) { this.kind = kind; this.flags = 0; this.name = ""; this.x = undefined; this.y = undefined; this.z = undefined; this.w = undefined; }
(Maker.prototype as any).x = "x of the prototype"; (Maker.prototype as any).z = "z of the prototype";
const Kind = Maker as unknown as new (kind: number) => Base;
function one(value: number): One { const made = new Kind(1) as One; made.value = value; return made; }
function two(text: string): Two { const made = new Kind(2) as Two; made.text = text; return made; }
type Thing = Base;
const make = (flags: number, name: string): Thing => { const made: Base = flags & 1 ? one(flags) : two(name); made.flags = flags; made.name = name; return made; };
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    said.push(label + " " + Object.keys(o).join());
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
}
bodyOfTheProgram();
