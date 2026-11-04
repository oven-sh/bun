// One deed a program: the maker gives x, y, z and w the constant undefined, which makes them own properties in the order of the text, whether anything is ever stored there or not. Made by staging/fields-born-undefined-1/make-family.py.
class Thing { flags: number; name: string; x?: object = undefined; y: number | undefined = undefined; z?: string = undefined; w?: Thing = undefined; constructor(flags: number, name: string) { this.flags = flags; this.name = name; } }
(Thing.prototype as any).x = "x of the prototype"; (Thing.prototype as any).z = "z of the prototype";
const make = (flags: number, name: string): Thing => new Thing(flags, name);
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    const copy = { ...o }; said.push(label + " " + Object.keys(copy).join() + " " + brief(copy.x) + brief(copy.z) + Object.hasOwn(copy, "z"));
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
