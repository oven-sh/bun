// One deed a program: x, y, z and w are optional fields of a record that its maker leaves out (or, in undefined-*, lists as undefined): absent until something is stored, then where the store put them in the order of the keys. Made by staging/fields-born-undefined-2/make-family-of-records.py.
interface Thing { flags: number; name: string; x?: object; y?: number; z?: string; w?: Thing }
const make = (flags: number, name: string): Thing => { const made = {} as Thing; made.flags = flags; made.name = name; return made; };
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    said.push(label + " " + Object.entries(Object.getOwnPropertyDescriptors(o)).map(([k, d]: any) => k + ":" + d.writable + d.enumerable + d.configurable + brief(d.value)).join());
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
