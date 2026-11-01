// The name stops naming the function that has the member.
let F = function () {};
F.n = 1;
const first = F;
F = function () {};
console.log(F.n, first.n);
