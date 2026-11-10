"use strict";
function even(n, width) { let s = 0; if (n > 0) for (let i = 0; i < width; i++) s = (s + boundOdd(n - 1, width) + 1) | 0; return s; }
function odd(n, width) { let s = 1; if (n > 0) for (let i = 0; i < width; i++) s = (s + boundEven(n - 1, width) + 2) | 0; return s; }
const boundOdd = odd.bind(null), boundEven = even.bind(null);
const width = +(process.argv[2] ?? 3); console.log(even(6, width), odd(5, width));
