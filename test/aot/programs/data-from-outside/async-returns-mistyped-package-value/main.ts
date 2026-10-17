// The package's declaration file is wrong about what these functions return. An async function with an inferred return type passes the value through `await` unchanged.
import { bytes, count, soon } from "./package.js";

async function declared(name: string) {
  await null;
  return bytes(name);
}
const arrow = async (name: string) => bytes(name);
async function withStatements(name: string) {
  if (name === "a") return count(name);
  return count(name + name);
}
async function ofPromise(name: string) {
  return soon(name);
}
async function throughAnother(name: string) {
  return await declared(name);
}

console.log("a declaration", String(await declared("a")));
console.log("an arrow", String(await arrow("a")));
console.log("with statements", String(await withStatements("a")), String(await withStatements("b")));
console.log("of a promise", String(await ofPromise("a")));
console.log("through another", String(await throughAnother("a")));
const kept = declared("b");
const value = await kept;
console.log("kept", typeof value, String(value));
const right = await declared("right:a");
console.log("where the declaration is right", right.length, right instanceof Uint8Array);
