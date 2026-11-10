"use strict";
function join(a, b) { return a + b; }
const plusFour = join.bind(null, 4), afterDash = join.bind(null, "-");
function numbers(turns) { let s = 0; for (let i = 0; i < turns; i++) s = (s + plusFour(i)) | 0; return s; }
function texts(turns) { let s = 0; for (let i = 0; i < turns; i++) s += afterDash(i).length; return s; }
const turns = +(process.argv[2] ?? 50); console.log(numbers(turns), texts(turns));
