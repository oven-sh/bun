// A list made by spreading a Set of whole numbers and a fraction is pushed onto another list and read back.
const u = [];
u.push([...new Set([1, 2.5, 3])]);
console.log(String(u[0][0] === 1), String(u[0][1] === 2.5), String(u[0][2] === 3), u[0].join());
