// One position is declared to hold a Uint8Array or a Buffer and holds each in turn. It is asked for members that the two answer otherwise.
type Both = Uint8Array | Buffer;
function use(given?: Both) {
  const view: Both = given ?? new Uint8Array([1, 2, 3]);
  return [
    view.lastIndexOf(2),
    view.lastIndexOf(2.5),
    view.constructor.name,
    Object.getPrototypeOf(view) === Uint8Array.prototype,
  ];
}
function ask(which: number) {
  return use(which === 0 ? undefined : Buffer.from("abc"));
}
console.log(JSON.stringify(ask(0)));
console.log(JSON.stringify(ask(1)));
console.log(JSON.stringify(ask(0)));
function plainly(view: Both) {
  return [
    view.lastIndexOf(2.5),
    view.indexOf(2),
    view.includes(2),
    view.toLocaleString(),
    view.toString(),
    view.constructor.name,
  ];
}
console.log(JSON.stringify(plainly(new Uint8Array([1, 2, 3]))), JSON.stringify(plainly(Buffer.from("abc"))));
function copies(view: Both) {
  const part = view.slice(0, 2);
  part[0] = 9;
  return [view[0], part.constructor.name, view.subarray(1).constructor.name];
}
console.log(JSON.stringify(copies(new Uint8Array([1, 2, 3]))), JSON.stringify(copies(Buffer.from("abc"))));
