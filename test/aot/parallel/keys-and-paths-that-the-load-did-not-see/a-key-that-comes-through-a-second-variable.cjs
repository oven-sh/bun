var i = 0;
{ function i() {} }
const j = i;
const got = [7][j];
console.log(got === 7 || got === undefined ? "OK" : "WRONG");
