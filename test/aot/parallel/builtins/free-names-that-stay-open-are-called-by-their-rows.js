// A program that may write on the global object under any name leaves its members open. What a free name finds is compared with the built-in, and the call goes by the row: the operation of the row is entered, not the host's function.
// COUNT: operation:operationAOTCodeURIOfAnyValue >= 75000
function mark(holder, name) {
  holder[name] = 1;
}
const holders = [globalThis, Math];
for (const holder of holders) mark(holder, "mine" + holders.length);
const handlers = {
  hasBody(headers) {
    return headers["transfer-encoding"] !== undefined || !isNaN(headers["content-length"]);
  },
  decoded(value) {
    if (typeof value !== "string" || value.length === 0) return value;
    return decodeURIComponent(value);
  },
  whole(value) {
    const number = parseInt(value, 10);
    return isFinite(number) ? number : 0;
  },
};
const names = Object.keys(handlers);
let sum = 0;
const some = [{ "content-length": "27" }, { "content-length": undefined }, { "transfer-encoding": "chunked" }];
const texts = ["42", "products", "a%20b", ""];
for (let turn = 0; turn < 100000; turn++) {
  if (handlers[names[0]](some[turn % 3])) sum++;
  sum += handlers[names[1]](texts[turn & 3]).length;
  sum += handlers[names[2]](texts[turn & 3]);
}
console.log(sum, globalThis.mine2, Math.mine2);
