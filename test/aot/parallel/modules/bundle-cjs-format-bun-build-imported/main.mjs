// A bundle in the commonjs format of bun build is imported by name.
import m, { a } from "./m.cjs";
console.log(JSON.stringify(m), a);
