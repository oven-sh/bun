import * as fs from "node:fs";
const read = fs.notInThisModule;
console.log(read === undefined, typeof read, typeof fs.notInThisModule, String(read), read == null, read ?? "defaulted", Object.is(read, undefined));
console.log([read].length, 0 in [read], JSON.stringify({ a: read }), JSON.stringify([read]), [read, 1].indexOf(undefined), [read].includes(undefined));
const holder = { held: fs.notInThisModule };
console.log("held" in holder, holder.held === undefined, Object.values(holder).length, new Map([[1, fs.notInThisModule]]).get(1) === undefined);
function describe(value) {
  return value === undefined ? "undefined" : "something else";
}
console.log(describe(fs.notInThisModule), describe(fs["notIn" + "ThisModule"]), Reflect.get(fs, "notInThisModule") === undefined);
console.log("notInThisModule" in fs, Object.keys(fs).includes("notInThisModule"), Object.getOwnPropertyDescriptor(fs, "notInThisModule"), typeof fs.existsSync);
