const view = new Uint8Array([1, 2, 3, 4]);
view.copyWithin(0, 2);
console.log(view.join());
