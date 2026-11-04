import whole, { a, zeta } from "./data.json";
console.log(a, zeta === whole.zeta);
whole.a = 99;
console.log(a, whole.a);
