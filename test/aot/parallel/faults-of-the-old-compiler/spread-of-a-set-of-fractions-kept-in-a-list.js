// A list made by spreading a Set of fractions is pushed onto another list and read back.
const u = [];
u.push([...new Set([2.5])]);
console.log(String(u[0][0] === 2.5));
