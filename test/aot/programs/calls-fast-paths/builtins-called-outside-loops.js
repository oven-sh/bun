// A call of a built-in that is known for what it is, in a function without a loop that no loop calls by name: it is carried out as it is in a loop: in place, or by the operation that does only what is asked, where the operands are what is expected of them.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
var splice = Array.prototype.splice, max = Math.max;
function removeAt(list, index) { return splice.call(list, index | 0, 1); }
function larger(a, b) { return max(a, b); }
var calls = [removeAt, larger];
var list = [];
for (var i = 0; i < 300; i++) list.push(i);
var before = count("operationAOTArraySplice"), sum = 0;
for (var i = 0; i < 200; i++) sum += calls[0](list, i % 50)[0] + calls[1](i, 100);
console.log(sum, list.length, typeof aotOperationCount === "function" ? count("operationAOTArraySplice") - before : 200);
console.log(JSON.stringify(removeAt({ length: 2, 0: "a", 1: "b" }, 0)), JSON.stringify(removeAt([1.5, 2.5], "1")), larger("3", 2), larger({ valueOf: function () { return 7; } }, 1), larger(NaN, 1), larger(-0, 0));
try { removeAt(null, 0); } catch (error) { console.log(error.name); }
try { larger(1n, 2); } catch (error) { console.log(error.name); }
