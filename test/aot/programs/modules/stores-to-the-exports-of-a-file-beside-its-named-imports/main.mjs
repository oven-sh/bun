// Stores to the exports of a file beside its named imports.
import d, { a, f } from "./m.cjs";
import * as ns from "./m.cjs";
console.log(a, f(), d.a, ns.a);
d.a = "stored"; d.f = () => "replaced"; d.added = "added";
console.log(a, f(), d.a, ns.a, ns.f(), ns.added, ns.default.added, Object.keys(ns).sort().join());
d.bump(); console.log(a, ns.a, d.a);
