// A namespace object that the program stores on the global object is read by text put together at run time: exports that the program never reads, functions it never calls, bindings that change later.
import * as whole from "./exports.mjs";
import { used, bump } from "./exports.mjs";
import * as again from "./passes-on.mjs";
const glue = (a, b) => [a, b].join(process.argv.length > 99 ? "x" : "");
globalThis.whole = whole;
console.log(used, new Function(glue("return whole.unread + ' ' + whole.neverCalled() + ' ' + Object.keys(whole).join()", ""))());
bump();
console.log(new Function(glue("return whole.counter + ' ' + whole.bump() + ' ' + whole.counter", ""))(), whole.counter);
console.log(new Function(glue("try { whole.counter = 9; return 'stored'; } catch (e) { return e.name; }", ""))(), whole.counter);
console.log(new Function(glue("whole.holder.n = 'x'; whole.holder.list.push('y'); return typeof whole.default", ""))(), typeof whole.holder.n, whole.twice(), whole.total());
globalThis.again = again;
console.log(new Function(glue("return Object.keys(again).join() + ' ' + again.renamed + ' ' + again.inner.unread", ""))());
globalThis.later = import("./loaded-later.mjs");
console.log(await new Function(glue("return later.then(m => m.unread + ' ' + m.neverCalled())", ""))());
