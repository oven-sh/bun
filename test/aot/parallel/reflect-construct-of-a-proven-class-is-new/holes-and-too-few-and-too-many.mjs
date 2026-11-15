class P { constructor(x, y, z) { this.t = [x, y, z, arguments.length].join(); } }
console.log(Reflect.construct(P, [1, , 3]).t, "|", Reflect.construct(P, []).t, "|", Reflect.construct(P, [1, 2, 3, 4, 5]).t, "|", Reflect.construct(P, [,]).t);
