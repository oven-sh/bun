// One deed a program: x, y, z and w are optional fields of a record that its maker leaves out (or, in undefined-*, lists as undefined): absent until something is stored, then where the store put them in the order of the keys. Made by staging/fields-born-undefined-2/make-family-of-records.py.
interface Thing { flags: number; name: string; x?: object; y: number | undefined; z?: string; w?: Thing }
const make = (flags: number, name: string): Thing => ({ flags, name, x: undefined, y: undefined, z: undefined, w: undefined });
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    const all: any[] = []; for (let i = 0; i < 300; i++) { const t = make(i, "t" + i); if (i % 7 === 0) t.z = "z" + i; if (i % 11 === 0) t.x = { i }; if (i % 13 === 0) t.y = i; all.push(t); } let sum = 0; for (const t of all) sum += (t.z ? t.z.length : 1) + (t.x ? 100 : 0) + (t.y ?? 3) + Object.keys(t).length; said.push(label + " " + sum);
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
