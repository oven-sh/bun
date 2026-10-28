const view = new Int8Array(2);
view[0] = 5;
Object.defineProperty(view, 0, { value: 1 });
console.log(view[0], view.join());
