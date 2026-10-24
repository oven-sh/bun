// `(m.f as any) = second` on the default import of a CommonJS module is seen by the next call of `m.f`.
import m from "./lib.cjs";
declare var console: any;
(m.f as any) = () => "second";
console.log(m.f());
