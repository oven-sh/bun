// objects with value of
let asked = 0;
const odd = { valueOf() { asked++; return 0; }, toString() { asked++; return ""; } };
console.log(!(odd && odd), !!(odd || 0), asked);
