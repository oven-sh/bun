"use strict";
const scale = 2;
function area(a, b) { return a * b * scale; }
module.exports = { area, scale, get whole() { return area(1, 1); }, round(x) { return x | 0; } };
