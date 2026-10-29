import * as lib from "./re-export.mjs";
const held = lib;
console.log(Object.keys(held).join(), held.a, held.own);
