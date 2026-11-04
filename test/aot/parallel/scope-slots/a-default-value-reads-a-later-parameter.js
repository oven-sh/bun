// The scope of the parameters: a default value runs in front of the parameter behind it.
function make(first = (() => { try { return second; } catch (e) { return e.name; } })(), second = 2) {
  return [first, second, (() => second)()].join();
}
for (let round = 0; round < 3; round++) console.log(make(), make(1), make(undefined, 5));
