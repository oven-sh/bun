// A reference that the checker has narrowed has that type, and its context says nothing more.
// parameter `x` = string
function shout(x) { if (typeof x === "string") return x.toUpperCase(); return null; }
// parameter `x` = any[]
function lengthOf(x) { return Array.isArray(x) ? x.length : 0; }
// parameter `x` = Date
function time(x) { return x instanceof Date ? x.getTime() : 0; }
// parameter `x` = string | { value?: any; }
function unwrap(x) { if (typeof x === "string") return x.trim(); return x.value; }
// parameter `x` = number | Function
function resolve(x) { return typeof x === "function" ? x() : x * 1; }
