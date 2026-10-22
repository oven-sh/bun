// `JSON.parse<T>(text)` in a .ts file builds an object of type T: the rule holds for it as for a literal. Plain Bun does every operation.
// Columns: kinds types. Elsewhere: not compared (under fields and wide the deletes, redefinitions and prototypes throw as stored, and the stores of another kind are done).
function attempt(label: string, f: () => unknown) {
  try { console.log(label + ":", String(f())); } catch (e) { console.log(label + ":", (e as Error).constructor.name); }
}
interface Config { host: string; port: number; note?: string }
const text = '{"host":"h","port":1,"note":"n"}';
const make = (): any => JSON.parse<Config>(text);
attempt("delete of a required property", () => delete make().host);
attempt("delete of an optional property", () => delete make().note);
attempt("a getter", () => Object.defineProperty(make(), "port", { get() { return 7; } }).port);
attempt("another prototype", () => { Object.setPrototypeOf(make(), {}); return "set"; });
attempt("a store of another kind", () => { const o = make(); o.port = "text"; return o.port; });
attempt("a store of the declared kind", () => { const o = make(); o.port = 2; return JSON.stringify(o); });
attempt("a new property", () => { const o = make(); o.extra = true; return JSON.stringify(o); });
const untyped = JSON.parse(text);
attempt("without a type, delete", () => delete untyped.host);
attempt("without a type, a store", () => { untyped.port = "text"; return JSON.stringify(untyped); });
