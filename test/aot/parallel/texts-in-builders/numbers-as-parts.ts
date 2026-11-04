// numbers of every kind are parts of the growth: written, proven by a test, and out of a list of which nothing is known
const hostile: number[] = JSON.parse("[0, 1, -1, 9, 10, 99, 100, 2147483647, -2147483648, 2147483648, 4294967295, 1.5, -1.5, 1e21, 1e-7, 123456789012345680000, 9007199254740993, 5e-324, 1.7976931348623157e308]");
hostile.push(-0, NaN, Infinity, -Infinity, 0.1 + 0.2, 2 ** 53, -(2 ** 53));
function anyNumber(list: number[]) { let s = ""; for (let i = 0; i < list.length; i++) s += list[i] + ","; return s; }
function cut(list: number[]) { let s = ""; for (let i = 0; i < list.length; i++) s += (list[i] | 0) + ","; return s; }
function unsigned(list: number[]) { let s = ""; for (let i = 0; i < list.length; i++) s += (list[i] >>> 0) + ","; return s; }
function alone(x: number, n: number) { let s = ""; for (let i = 0; i < n; i++) s += x; return s; }
function written(n: number) { let s = ""; for (let i = 0; i < n; i++) { s += -0; s += 1.5; s += 1e21; s += NaN; s += 0; s += -7; } return s; }
function counted(from: number, to: number, step: number) { let s = ""; for (let i = from; i < to; i += step) s += i; return s; }
console.log(anyNumber(hostile));
console.log(cut(hostile));
console.log(unsigned(hostile));
console.log(alone(-0, 3), alone(NaN, 2), alone(-2147483648, 2), alone(0.5, 2));
console.log(written(0).length, written(2));
console.log(counted(-3, 3, 1), counted(2147483645, 2147483650, 1), counted(0, 2, 0.5), counted(-0, 1, 1));
