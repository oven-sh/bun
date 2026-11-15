const all = ['x1y2', 'a-1 b-2', '', 'ba', 'abc'];
const re = /(a(b)?)+/;
function f(string) { let s = 0; const array = re.exec(string); if (array) { for (let j = 0; j < array.length; j++) { const part = array[j]; if (part) s += part.length; } } return s; }
function g(list) { let n = 0; for (let i = 0; i < list.length; i++) n += f(list[i]); return n; }
console.log(g(all), g(all)); re.extra = 1; console.log(g(all));
