// An arithmetic operand is a number. An operand of a bitwise operator and the index of an element of a list are int32.
// predicted `a` = number
function negate(a) { return -a; }
// predicted `a` = number
function scale(a) { return a * 2; }
// predicted `a` = number
function count(a) { a++; return a; }
// predicted `a` = number
function decrease(a) { a -= 1; return a; }
// parameter `a` = int32
function mask(a) { return a & 255; }
// parameter `a` = int32
function flip(a) { return ~a; }
// parameter `i` = int32
function letter(i) { return "text"[i]; }
// predicted `a` = number
function isSmall(a) { return a < 10; }
// parameter `a` = string
function isEarly(a) { return a < "m"; }
// predicted `a` = number
function increment(a) { return a + 1; }
// parameter `a` = any
function greet(a) { return a + "!"; }
// parameter `a` = any
// parameter `b` = any
function add(a, b) { return a + b; }
// parameter `a` = any
function isSame(a) { return a === 1; }
// `number` alone is not expected of a parameter where the function is entered: the operators find out by themselves. int32 is.
// parameter `a` = any
function halved(a) { return a / 2; }
// parameter `a` = int32
function masked(a) { return a & 255; }
// parameter `o` = { w?: number; }
function width(o) { return o.w * 2; }
// A variable that starts as an integer, gets only integers and unknown values, and is a key or a bitwise operand is int32.
// binding `i` = int32
// predicted `i` = int32
function walk(list) { for (let i = 0; i < 9; i++) list[i] = 0; }
// binding `pc` = int32
// predicted `pc` = int32
function step(code, frame) { let pc = 0; while (code[pc]) { pc = pc + 2; if (code[pc + 1]) pc = frame.target; } return pc; }
// binding `i` = int32
// binding `n` = number
function each(list, visit) { for (var i = 0, n = list.length; i < n; i++) visit(list[i]); }
// binding `at` = int32
function peek(code) { let at = 0; at += 2; return code[at + 1]; }
// binding `bits` = int32
function collect(flags) { let bits = 0; for (const flag of flags) bits |= flag; return bits; }
// binding `last` = int32
function lastLetter() { const text = "text"; let last = text.length - 1; while (text[last] === " ") last--; return last; }
// binding `i` = int32
// binding `next` = int32
function neighbor(list) { let i = 0; let next = i + 1; return list[next] - list[i]; }
// It stays a number where nothing uses it as an int32, where it starts as a fraction, and where a quotient, a product or the result of `>>>` is stored.
// binding `total` = number
function sum(list) { let total = 0; for (const item of list) total += item; return total; }
// binding `half` = number
function halve(list) { let half = 8; half = half / 2; return list[half]; }
// binding `at` = number
function middle(list) { let at = 0.5; at++; return list[at]; }
// binding `size` = number
function grow(list) { let size = 1; size *= 2; return list[size]; }
// binding `hash` = number
function shift() { let hash = 7; hash >>>= 1; return hash; }
// A parameter holds what its callers pass, whatever its default is.
// binding `i` = number
function pick(list, i = 0) { return list[i]; }
