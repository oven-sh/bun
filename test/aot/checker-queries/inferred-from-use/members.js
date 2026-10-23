// A name that is read or stored is a member. It is required where a use of its value throws without it, optional otherwise.
const kState = Symbol("state");
// parameter `point` = { x?: number; y?: number; }
function squaredLength(point) { return point.x * point.x + point.y * point.y; }
// parameter `logger` = { log: Function; }
function report(logger) { logger.log("x"); }
// parameter `o` = { Type: Function; }
function create(o) { return new o.Type(); }
// parameter `o` = { name?: any; }
function bracket(o) { return o["name"]; }
// parameter `options` = { timeout?: any; }
function timeoutOf(options) { return options.timeout || 100; }
// parameter `o` = { a: { b?: any; }; }
function deep(o) { return o.a.b; }
// parameter `o` = { a?: { b?: any; }; }
function optionalChain(o) { return o.a?.b; }
// parameter `o` = { a: { b?: any; }; }
function guarded(o) { if (o.a) return o.a.b; return null; }
// parameter `o` = { list: string | any[]; }
function iterated(o) { for (const item of o.list) return item; return null; }
// parameter `o` = { count?: number; label?: string; }
function reset(o) { o.count = 0; o.label = ""; }
// parameter `o` = { a: { b?: number; }; }
function storeDeep(o) { o.a.b = 1; }
// parameter `o` = { [kState]?: boolean; }
function mark(o) { o[kState] = true; }
// parameter `o` = { [kState]?: any; }
function marked(o) { return o[kState]; }
// parameter `o` = { cache?: any; }
function clear(o) { delete o.cache; }
// parameter `o` = object
// parameter `k` = any
function get(o, k) { return o[k]; }
// parameter `o` = object
function has(o) { return "a" in o; }
// parameter `o` = object
function countKeys(o) { let n = 0; for (const k in o) n++; return n; }
// parameter `o` = object
function copy(o) { return { ...o }; }
// parameter `o` = { list: string | any[]; }
function spreadMember(o) { return [...o.list]; }
// parameter `o` = { flag?: any; kind?: any; }
function comparedAndTested(o) { return o.kind === 1 || !o.flag; }
// parameter `o` = { table: object; }
function keyedMember(o, k) { return o.table[k]; }
// parameter `o` = { f?: Function; }
function optionalCall(o) { return o.f?.(); }
// An object that is also enumerated, or read by a computed key, is a dictionary: the names that are spelled do not describe it.
// parameter `o` = object
function walked(o) { let n = o.version; for (const key in o) n += o[key]; return n; }
// parameter `o` = object
function copied(o) { return { ...o, size: o.size }; }
// parameter `o` = { table: object; }
function looked(o, key) { return o.table[key] || o.table.fallback; }
