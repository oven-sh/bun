// The test tells a member that was never stored from one that holds undefined.
function F() {}
console.log("n" in F);
F.n = undefined;
console.log("n" in F, F.n);
