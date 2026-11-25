var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var count = 0;
var require_n = __commonJS((exports) => { count++; let n = 0; class Step { take() { return ++n; } } const step = new Step(); exports.next = () => step.take(); });
export function ask() { return require_n(); }
export function runs() { return count; }
