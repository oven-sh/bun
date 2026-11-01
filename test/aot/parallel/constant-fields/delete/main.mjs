// `const E = {}; E.A = 0;`: a read of E.A becomes 0 where every store is known and none can be caught, refused or followed by another value.
// Alone: what is put off, and what is found constant, goes by all that the executable holds
const say = run => { try { console.log(run()); } catch (e) { console.log(e.name + ": " + e.message); } };
import { read, whole } from "./m.mjs";
delete whole().A;
say(() => read());
