// A Buffer and a Uint8Array come back from one function. What takes the Uint8Array alone asks it for members that a Buffer answers otherwise.
function given<T>(view: T): T {
  return view;
}
function lengthOf(view: Uint8Array): number {
  return view.length;
}
function describe(view: Uint8Array): string {
  return [
    view.toString(),
    view.slice(0, 1).constructor.name,
    view instanceof Buffer,
    view.subarray(1).constructor.name,
  ].join(" ");
}
console.log(String(given(Buffer.from("ab"))));
console.log(lengthOf(given(new Uint8Array(2))));
console.log(describe(given(new Uint8Array([7, 8]))));
console.log([new Uint8Array(3)].map(view => lengthOf(given(view))).join());
