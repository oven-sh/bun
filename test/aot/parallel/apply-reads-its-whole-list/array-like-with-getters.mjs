let calls = 0, events = "";
function tick() { calls++; }
function makeRow() {
  return {
    get length() { events += "L"; return 2; },
    get 0() { events += "a"; return 1; },
    get 1() { events += "b"; return 2; },
  };
}
function byApply() { tick.apply(null, makeRow()); }
function byReflect() { Reflect.apply(tick, null, makeRow()); }
for (let i = 0; i < 300; i++) byApply();
console.log(calls, events.length, events.slice(0, 9));
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, events.length, events.slice(-9));
