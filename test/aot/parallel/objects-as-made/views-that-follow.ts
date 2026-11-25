function sum(view: Uint8Array): number {
  let total = 0;
  for (let k = 0; k < view.length; k++) total += view[k];
  return total + view.indexOf(7);
}
const buffer = new ArrayBuffer(4, { maxByteLength: 16 });
const view = new Uint8Array(buffer);
view[2] = 7;
console.log(sum(view));
buffer.resize(8);
view[6] = 1;
console.log(sum(view), view.length);
