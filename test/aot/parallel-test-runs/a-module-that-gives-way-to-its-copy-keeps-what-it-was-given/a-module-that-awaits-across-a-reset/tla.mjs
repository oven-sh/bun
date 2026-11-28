globalThis.p = (globalThis.p ?? 0) + 1;
console.log("p");
export let v = "p" + globalThis.p;
export function bump() {
  v += "+";
}
await 0;
console.log("p end");
