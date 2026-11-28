globalThis.p = (globalThis.p ?? 0) + 1;
console.log("p");
exports.v = "p" + globalThis.p;
exports.bump = () => {};
