const buffer = new ArrayBuffer(8);
const view = new Uint8Array(buffer);
view[0] = 7;
const moved = structuredClone(buffer, { transfer: [buffer] });
console.log(view.length, view[0] === undefined, buffer.byteLength, new Uint8Array(moved)[0]);
