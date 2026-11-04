let calls = 0, caught = 0, name = "";
function tick() { calls++; }
class Refusal extends Error {}
const descriptor = { get() { throw new Refusal("no"); } };
function byApply() {
  const list = [1, 2];
  Object.defineProperty(list, 1, descriptor);
  try {
    tick.apply(null, list);
  } catch (error) {
    caught++;
    name = error.constructor.name;
  }
}
function byReflect() {
  const list = [1, 2];
  Object.defineProperty(list, 1, descriptor);
  try {
    Reflect.apply(tick, null, list);
  } catch (error) {
    caught++;
    name = error.constructor.name;
  }
}
for (let i = 0; i < 300; i++) byApply();
console.log(calls, caught, name);
for (let i = 0; i < 300; i++) byReflect();
console.log(calls, caught, name);
