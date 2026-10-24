// A direct eval sees the declarations of its module that carry the word `export`: it reads them and stores to them from wherever it stands, and an importer sees the stores.
import { total, storeByEval, readByEval } from "./counter.js";
export const limit = 5;
export let count = 0;
export var old = "var";
export function double(n) { return n * 2; }
export class Box { constructor(v) { this.v = v; } }
export default function named() { return "the default export"; }
export const { first, second: [inner] } = { first: 1, second: ["inner"] };
const hidden = "not exported";
function listed() { return "listed at the foot"; }
export { listed as renamed };

console.log(eval("typeof limit"), eval("typeof count"), eval("typeof old"), eval("typeof double"), eval("typeof Box"), eval("typeof named"), eval("typeof first"), eval("typeof inner"));
console.log(eval("typeof hidden"), eval("typeof listed"), eval("typeof renamed"), eval("typeof nowhere"));
console.log(eval("limit"), eval("double(limit)"), eval("new Box(limit).v"), eval("named()"), eval("first + inner"));

eval("count = 5"); console.log(count);
eval("count++"); console.log(count, eval("count"));
eval("old = 'stored'"); console.log(old);
try { eval("limit = 6"); } catch (error) { console.log(error.name, limit); }

function inFunction(text) { return eval(text); }
const inArrow = text => eval(text);
class Holder { method(text) { return eval(text); } static field = eval("limit + 1"); }
async function inAsync(text) { return eval(text); }
function* inGenerator(text) { yield eval(text); }
function shadows(limit) { return eval("limit"); }
function nested() { return (() => { { return eval("double(limit) + count"); } })(); }
console.log(inFunction("limit + count"), inArrow("double(count)"), new Holder().method("typeof Box"), Holder.field, [...inGenerator("named()")][0], shadows("the parameter"), nested());
console.log(await inAsync("limit"));
inFunction("count = 40"); console.log(count);

console.log(total, readByEval("total"));
storeByEval("total = 7"); console.log(total, readByEval("total + 1"));
storeByEval("total += 1"); console.log(total);
