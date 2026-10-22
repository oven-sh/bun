const view = new Float64Array([1.5, 2.5]);
console.log(view.find(value => value > 9) === undefined, view.findLast(value => value > 9) === undefined, view.find(value => value > 2) + 1);
