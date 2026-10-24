// Which default exports follow a later store.
import f, { bumpF } from "./fn.mjs";
import v, { bumpV } from "./value.mjs";
import w, { bumpW } from "./renamed.mjs";
import C, { replaceC } from "./class.mjs";
console.log(f(), v, w, new C().n);
bumpF(); bumpV(); bumpW(); replaceC();
console.log(typeof f === "function" ? f() : f, v, w, typeof C === "function" ? new C().n : C);
