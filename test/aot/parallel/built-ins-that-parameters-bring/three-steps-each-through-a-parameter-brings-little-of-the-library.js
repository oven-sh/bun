// STATISTIC: ImageFunctionsEmitted <= 8
function a(o) { return o.Object; } function b(o) { return o.prototype; } function c(o) { return o.hasOwnProperty; } console.log(c(b(a(globalThis))).call({ x: 1 }, "x"));
