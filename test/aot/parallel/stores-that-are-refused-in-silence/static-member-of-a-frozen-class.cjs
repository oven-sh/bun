class A { static x = 1; }
Object.freeze(A);
A.x = 2; A.y = 3;
console.log(A.x, A.y);
