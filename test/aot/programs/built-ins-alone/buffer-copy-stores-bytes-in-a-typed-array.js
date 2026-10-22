const view = new Uint8Array(3);
console.log(view[0]);
Buffer.from([7, 8]).copy(view, 1);
console.log(view[0], view[1] + 1, view[2] + 1);
