// An element access or an iteration proposes an Array or a string, and the members used rule out the one that lacks them. Names alone propose neither, and where an Array, a string or a function has them all they say nothing.
// parameter `a` = any
function size(a) { return a.length; }
// parameter `a` = any
function tail(a) { return a.slice(1); }
// parameter `a` = any
function has(a, x) { return a.includes(x) || a.indexOf(x) > 0 || a.at(0) === x || a.concat(x).length; }
// parameter `s` = any
function tidy(s) { return s.trim().toLowerCase().padStart(4); }
// parameter `s` = any
function begins(s) { return s.slice(1).length && s.startsWith("a"); }
// parameter `a` = any
function grown(a) { a.push(1); return a.slice(1); }
// parameter `o` = any
function described(o) { return o.toString() + o.length; }
// parameter `a` = string | any[]
function first(a) { return a[0]; }
// parameter `a` = string | any[]
function last(a) { return a[a.length - 1]; }
// parameter `a` = number[]
function fill(a) { for (let i = 0; i < a.length; i++) a[i] = 0; }
// parameter `rows` = { size: { w?: number; }; }[]
function total(rows) { let sum = 0; for (let i = 0; i < rows.length; i++) sum += rows[i].size.w * 2; return sum; }
// parameter `a` = { id?: any; }[]
function ids(a) { const out = []; for (const item of a) out.push(item.id); return out; }
// parameter `pair` = string | any[]
function swap(pair) { const [x, y] = pair; return [y, x]; }
// parameter `pair` = number[]
function difference(pair) { const [x, y] = pair; return x - y; }
// parameter `a` = string | any[]
function maximum(a) { return Math.max(...a); }
// parameter `a` = string | any[]
function clone(a) { return [...a]; }
// parameter `a` = any
function append(a) { a.push(1); }
// parameter `a` = any
function truncate(a) { a.length = 0; }
// parameter `s` = any
function code(s) { return s.charCodeAt(0); }
// parameter `a` = string | any[]
// parameter `i` = int32
function previous(a, i) { return a[i] || a[i - 1]; }
// parameter `a` = { name?: any; }
function namedList(a) { return a[0] || a.name; }
// parameter `s` = string
function firstLetter(s) { if (typeof s === "string") s.trim(); return s[0]; }
// parameter `a` = any[]
function firstItem(a) { if (Array.isArray(a)) a.pop(); return a[0]; }
// A name that an Array has as a method does not make an Array of a value that only reads it.
// parameter `layer` = { keys: string | any[]; }
function countKeys(layer) { const keys = layer.keys; return keys.length + keys[0]; }
// parameter `o` = { forEach?: any; }
function hasForEach(o) { return !!o.forEach; }
// parameter `holder` = { items?: any[]; }
function reset(holder) { holder.items = []; }
// parameter `queue` = { ops: { size?: any; }[]; }
function refill(queue) { queue.ops = []; return queue.ops[0].size; }
