class Odd extends Array { static get [Symbol.species]() { return function (n) { return { made: n }; }; } }
const odd = Odd.from(JSON.parse('[0,1,2]'));
console.log(JSON.stringify(odd.filter(Boolean)));
