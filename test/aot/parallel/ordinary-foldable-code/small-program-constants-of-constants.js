const A = 1;
const B = A + 1;
const C = B * 2;
const D = `${C}px`;
const E = D.length;
const F = E > 2 ? D : "0";
const G = [A, B, C].includes(E);
const H = { A, B, C, D, E, F, G };
console.log(H, Object.keys(H).length === 7);
