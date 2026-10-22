const view = new Uint8Array([1, 2]);
console.log(view[5] === undefined, view.at(5) === undefined, view.at(-1) + 1, view[-1] === undefined, typeof view[2]);
