// export { name } of a later declaration, of an import, and with a from clause.
export { f }; function f() {}
export { a }; let a;
export { C }; class C {}
import * as ns from "node:fs"; export { ns };
export { readFile } from "node:fs";
