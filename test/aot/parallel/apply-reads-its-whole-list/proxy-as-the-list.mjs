let calls = 0, asked = 0, names = "";
function tick() { calls++; }
const handler = {
  get(target, key, receiver) {
    asked++;
    if (asked <= 3) names += String(key) + " ";
    return Reflect.get(target, key, receiver);
  },
};
function byApply() { tick.apply(null, new Proxy([1, 2], handler)); }
function byReflect() { Reflect.apply(tick, null, new Proxy([1, 2], handler)); }
for (let i = 0; i < 300; i++) byApply();
console.log(calls, asked, names);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, asked, names);
