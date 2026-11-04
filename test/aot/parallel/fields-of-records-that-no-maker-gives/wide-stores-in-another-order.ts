// One deed a program: x, y, z and w are optional fields of a record that its maker leaves out (or, in undefined-*, lists as undefined): absent until something is stored, then where the store put them in the order of the keys. Made by staging/fields-born-undefined-2/make-family-of-records.py.
interface Thing { flags: number; a0?: number; a1?: number; a2?: number; a3?: number; a4?: number; a5?: number; a6?: number; a7?: number; a8?: number; a9?: number; a10?: number; a11?: number; a12?: number; a13?: number; a14?: number; a15?: number; a16?: number; a17?: number; a18?: number; a19?: number; a20?: number; a21?: number; a22?: number; a23?: number; a24?: number; a25?: number; a26?: number; a27?: number; a28?: number; a29?: number; a30?: number; a31?: number; a32?: number; a33?: number; a34?: number; a35?: number; a36?: number; a37?: number; a38?: number; a39?: number; a40?: number; a41?: number; a42?: number; a43?: number; a44?: number; a45?: number; a46?: number; a47?: number; a48?: number; a49?: number; a50?: number; a51?: number; a52?: number; a53?: number; a54?: number; a55?: number; a56?: number; a57?: number; a58?: number; a59?: number; a60?: number; a61?: number; a62?: number; a63?: number; a64?: number; a65?: number; a66?: number; a67?: number; a68?: number; a69?: number; name: string; x?: object; y?: number; z?: string; w?: Thing }
const make = (flags: number, name: string): Thing => { const made: Thing = { flags, name }; if (flags & 2) { made.a3 = 3; made.a66 = 66; made.a69 = 69; made.a0 = 0; } return made; };
function fill(thing: Thing, on: Thing) { thing.x = { inner: 1 }; thing.y = 7; thing.w = on; }
const brief = (v: any): string => v === undefined ? "undefined" : typeof v === "object" && v !== null ? "{" + Object.keys(v).join("+") + "}" : String(v);
const other = make(8, "other"); (other as any).later = 1;
const fresh = make(1, "fresh"); const filled = make(2, "filled"); fill(filled, fresh);
const said: string[] = [];
function deed(o: any, label: string) {
    o.w = undefined; o.z = "z"; o.y = 1; o.x = { last: 1 }; said.push(label + " " + Object.keys(o).join() + " " + JSON.stringify(o));
}
deed(fresh, "fresh"); deed(filled, "filled");
console.log(said.join("\n"));
