const view = new Float64Array([2.5, NaN, -0, 0, -1.5]);
view.sort();
console.log(view.join(), Object.is(view[1], -0));
