function g(a) { Object.freeze(arguments); arguments[0] = 2; a = 3; return arguments[0] + " " + a; }
console.log(g(1));
