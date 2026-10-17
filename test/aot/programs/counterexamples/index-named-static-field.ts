// `static 7 = ..` is read as `A[7]`.
class A { static 7 = "seven"; }
console.log(A[7]);
