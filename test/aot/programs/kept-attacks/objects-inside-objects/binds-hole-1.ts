// Objects inside objects: binds hole. It prints what plain Bun prints.
const unseen = Function("a", "b", process.argv[9] ?? "Object.defineProperty(a, 'name', { value: 'renamed' }); b.bind = function () { return function hijacked() { return -1; }; }; return 1;");
function first(a: number, b: number): number { return a + b; }
function second(a: number, b: number): number { return a * b; }
function show(f: (b: number) => number): void { console.log(f.name, f.length, f(2)); }
function bindBoth(): void { show(first.bind(null, 10)); show(second.bind(null, 10)); }
bindBoth();
console.log(unseen(first, second));
bindBoth();
