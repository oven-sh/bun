// A parameter that is an object pattern has the members that the pattern names, typed by the uses of the variables.
// parameter `{ a, b }` = { a?: number; b: { c?: number; }; }
function take({ a, b }) { return a * b.c; }
// parameter `{ size = 1 }` = { size?: number; }
function withDefault({ size = 1 }) { return size; }
// parameter `{ a: { b } }` = { a: { b?: number; }; }
function nested({ a: { b } }) { return b + 1; }
// parameter `{ a, ...rest }` = { a?: any; }
function withRest({ a, ...rest }) { return [a, rest]; }
// parameter `[x, y]` = [any, any]
// binding `x` = number
// binding `y` = number
function pair([x, y]) { return x - y; }
// parameter `o` = { a?: number; }
function passesOn(o) { return onlyA(o); }
// parameter `{ a }` = { a?: number; }
function onlyA({ a }) { return a * 2; }
