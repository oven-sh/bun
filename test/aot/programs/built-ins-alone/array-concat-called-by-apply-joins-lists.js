const flat = Array.prototype.concat.apply([], [[1.5], ["two"]]);
console.log(flat.length, flat[0] + 1, flat[1].length);
