// Impostors probe: arguments object. It prints what plain Bun prints.
function collect(a, b) { arguments[0] = 9; return [a, arguments.length, Array.prototype.slice.call(arguments).join()]; }
console.log(collect(1, 2, 3).join(" "));
