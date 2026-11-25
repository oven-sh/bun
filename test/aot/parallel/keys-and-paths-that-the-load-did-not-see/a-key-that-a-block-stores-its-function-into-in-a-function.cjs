function f() { var i = 0; { function i() {} } return [7][i]; }
const got = f();
console.log(got === 7 || got === undefined ? "OK" : "WRONG");
