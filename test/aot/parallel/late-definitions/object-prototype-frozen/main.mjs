// A built-in prototype is frozen or changed between the declaration and the first read. A definition asks nobody above.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read } from "./m.mjs";
Object.freeze(Object.prototype);
say(() => { const [A, B, f, re] = read(); return [new A().m(), A.s(), String(new B()), B.s(), B.t, f(), typeof f.prototype, re.lastIndex, re.test("a"), re.lastIndex, Object.getOwnPropertyNames(A).join("/")].join(); });
