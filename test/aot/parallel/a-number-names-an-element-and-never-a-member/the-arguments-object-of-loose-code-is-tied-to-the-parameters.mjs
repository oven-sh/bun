const f = new Function("i", "a", "arguments[i] = 'text'; return typeof a;");
console.log(f(1, 5));
