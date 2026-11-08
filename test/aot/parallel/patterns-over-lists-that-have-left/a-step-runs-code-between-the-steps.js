// A default of the pattern runs code that writes the list before the next step reads it.
function taken(a) { const list = [undefined, a]; const holder = { list }; const { list: [first = (list[1] = 99, list.push(5), 1), second, third = 3] } = holder; return first + second + third; }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += taken(i); return t; }
console.log(run(100));
