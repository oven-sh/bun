import { word } from "./leaf.mjs";
import D from "./leaf.mjs";
import * as all from "./leaf.mjs";
function* gen() { yield word; }
async function* agen() { yield word; }
class A { #p = word; static s = word; get g() { return word; } static { this.b = () => word; } p() { return this.#p + word; } [(() => "c")()]() { return all.word; } }
const o = { word, get w() { return word; }, m() { return D.w; }, f: (x = word) => x };
let last; agen().next().then(it => { last = it.value; });
label: for (const x of [1]) { var loop = () => word; continue label; }
try { throw 1; } catch { var caught = () => all.word; }
export const view = () => [[...gen()][0], new A().g, A.s, A.b(), new A().p(), new A().c(), o.word, o.w, o.m(), o.f(), loop(), caught(), eval("word"), new Function("return 1")(), `${word}`, typeof word, (() => { with_(); function with_() { last = word; } return last; })()].join();
