// The handler is written in place and has a trap for stores alone, which has no `this`. What the host asks of the object below goes on at the target.
// STATISTIC: ImageFunctionsEmitted <= 20 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
const stored = [];
const below = Object.create(new Proxy({ kept: 1 }, { set(target, key, value) { stored.push(String(key)); return true; } }));
below.first = 1;
console.log(below);
console.log(below.kept, stored.join());
