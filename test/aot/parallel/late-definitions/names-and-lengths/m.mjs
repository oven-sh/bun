const f = function (a, b) {};
const g = (a) => a;
const C = class { constructor(a, b, c) {} };
const h = function inner() {};
export const read = () => [f, g, C, h];
