const view = new Uint8Array([1, 2, 3]);
const part = view.subarray(1);
part[0] = 9;
console.log(view[1] + 1, part.length);
