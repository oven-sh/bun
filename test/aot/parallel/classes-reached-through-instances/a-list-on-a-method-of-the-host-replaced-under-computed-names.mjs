Event.prototype.preventDefault.list = [1, 2];
let h = globalThis;
for (const name of JSON.parse(`["Event", "prototype", "preventDefault"]`)) h = h[name];
h.list = { length: 3 };
function read() {
  return Event.prototype.preventDefault.list.length;
}
console.log(read());
