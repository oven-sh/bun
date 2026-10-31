// The constructor reads `cause`.
function O() {}
O.cause = "why";
console.log(new Error("x", O).cause);
