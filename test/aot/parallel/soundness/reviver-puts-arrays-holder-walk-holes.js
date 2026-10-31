// JSON.parse goes into what the reviver has put into the holder while an earlier key was visited. Here arrays of numbers and of objects, which get holes and values of other kinds.
function attempt(f) { try { return f(); } catch (e) { return "threw " + e.constructor.name; } }
const numbers = [1, 2, 3, 4], objects = [{ qb: 1 }, { qb: 2 }], doubles = [1.5, 2.5, 3.5];
function sum(a) { let t = 0; for (let i = 0; i < a.length; i++) t += a[i]; return t; }
JSON.parse('{"a":1,"b":2,"c":3,"d":4}', function (k, v) {
  if (k === "a") { this.b = numbers; this.c = objects; this.d = doubles; }
  if (this === numbers) return k === "1" ? undefined : k === "2" ? "s" : v;
  if (this === objects) return k === "0" ? 5 : v;
  if (this === doubles) return k === "1" ? undefined : v;
  return v;
});
console.log(sum(numbers), 1 in numbers, numbers.length, attempt(() => objects[0].qb), attempt(() => objects[1].qb), sum(doubles), 1 in doubles);
console.log(sum([1, 2, 3, 4]), sum([1.5, 2.5]));
