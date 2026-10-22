const list = [1, ["text"], [[2.5]]];
const flat = list.flat();
console.log(flat.length, flat[0] + 1, flat[1].length, Array.isArray(flat[2]), flat[2][0] + 1);
