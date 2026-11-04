function f(a) { function put(h, i, v) { h[i] = v; } put(arguments, [].length, "text"); return typeof a + typeof arguments[0]; }
console.log(f(1));
