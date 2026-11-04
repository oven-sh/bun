// A list made by spreading a Set of fractions is pushed onto another list and read back: typed.
const u: number[][] = [];
u.push([...new Set<number>([2.5])]);
console.log(String(u[0][0] === 2.5));
export {};
