// One deed a program: x, y, z and w are optional fields of a record that its maker leaves out (or, in undefined-*, lists as undefined): absent until something is stored, then where the store put them in the order of the keys. Made by staging/fields-born-undefined-2/make-family-of-records.py.
interface Thing { flags: number; name: string; x?: { inner?: number; deep?: number }; y?: number; z?: string; w?: Thing }
const make = (flags: number, name: string): Thing => JSON.parse('{"flags":' + flags + ',"name":' + JSON.stringify(name) + '}') as Thing;
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    const all: any[] = []; for (let i = 0; i < 20000; i++) { const t = make(i, "t"); if (i % 3 === 0) t.x = { i }; if (i % 5 === 0) t.w = all[i >> 1]; if (i % 100 === 0) all.length = 0; all.push(t); } (globalThis as any).Bun?.gc(true); let sum = 0; for (const t of all) sum += (t.x ? t.x.i : 1) + (t.w ? t.w.flags : 2); said.push(label + " " + sum);
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
