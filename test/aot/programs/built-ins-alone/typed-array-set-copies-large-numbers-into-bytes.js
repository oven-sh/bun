const view = new Uint8Array(3);
view.set([256, -1, 1.9], 0);
console.log(view[0], view[1], view[2]);
