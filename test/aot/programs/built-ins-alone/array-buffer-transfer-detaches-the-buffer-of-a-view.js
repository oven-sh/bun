const buffer = new ArrayBuffer(8);
const view = new Uint8Array(buffer);
view[0] = 7;
const moved = buffer.transfer();
console.log(view.length, view[0] === undefined, buffer.byteLength, buffer.detached, new Uint8Array(moved)[0]);
