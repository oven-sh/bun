namespace Box {
  export let size = "member";
  // @ts-ignore
  export function put(o: object): void { with (o) { size = "stored"; } }
}
const o = { size: "kept" };
Box.put(o);
console.log(o.size, Box.size);
