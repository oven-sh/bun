// `k.m.bind(k)` on an async method: the result inherits from `AsyncFunction.prototype`.
import "../../../fixtures/jsc-shell-functions.ts";
import "./program.ts";
/* Output:
bytes alive for an object, its bound method and the array's slot: 72
5050 400000 true
*/
