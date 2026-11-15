function fillWith(view, value) { return view.fill(value); }
function find(view, value) { return view.indexOf(value); }
function cut(view) { return view.slice(1, 3); }
const relinked = Object.setPrototypeOf(new Uint8Array(6), Buffer.prototype);
const constructedFor = Reflect.construct(Uint8Array, [6], Buffer);
const plain = new Uint8Array(6);
const real = Buffer.alloc(6);
for (const view of [relinked, constructedFor, plain, real]) {
  const filled = fillWith(view, "ab");
  const part = cut(view);
  part[0] = 33;
  console.log(filled === view, Array.from(view).join(), find(view, "b"), find(view, 98), Object.getPrototypeOf(part) === Buffer.prototype, view[1]);
}
const late = new Uint8Array(4).fill(1);
Object.setPrototypeOf(late, Buffer.prototype);
console.log(late.fill("z").toString(), late.indexOf("z"), new Uint8Array(4).fill("z").join());
