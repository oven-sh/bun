const view = new Float64Array(3);
view.set({ length: 2, 0: 1.5, 1: "2.5" }, 1);
console.log(view[0], view[1] + 1, view[2] + 1);
