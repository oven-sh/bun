// Objects inside objects: binds hole. It prints what plain Bun prints.
interface Box { value: number }
const unseen = Function("a", "b", process.argv[9] ?? "Object.defineProperty(a, 'name', { value: 'renamed' }); b.bind = function () { return function hijacked() { return -1; }; }; return 1;");
function first(a: Box, b: Box): number { return a.value + b.value; }
function second(a: Box, b: Box): number { return a.value * b.value; }
function show(f: (b: Box) => number): void { console.log(f.name, f.length, f({ value: 2 })); }
function bindBoth(box: Box): void { show(first.bind(null, box)); show(second.bind(null, box)); }
bindBoth({ value: 10 });
console.log(unseen(first, second));
bindBoth({ value: 10 });
