// What a closure keeps between its calls belongs to the call of the factory that made it.
function memoize(compute) {
  const known = new Map();
  let misses = 0;
  return function (key) {
    if (!known.has(key)) {
      misses++;
      known.set(key, compute(key));
    }
    return [known.get(key), misses];
  };
}

function counter(start) {
  let count = start;
  return () => count++;
}

const lazy = make => {
  let value,
    made = false;
  return () => (made ? value : ((made = true), (value = make())));
};

const square = memoize(n => n * n);
const shout = memoize(text => text.toUpperCase());
const list = memoize(n => [n]);
console.log(square(3), square(3), square(4), shout("a"), shout("a"), shout("b"), list(1), list(1)[0] === list(1)[0]);

const fromZero = counter(0);
const fromTen = counter(10);
const fromText = counter("x");
console.log(fromZero(), fromZero(), fromTen(), fromZero(), fromTen(), fromText(), fromText());

let runs = 0;
const number = lazy(() => ++runs);
const object = lazy(() => ({ runs: ++runs }));
const nothing = lazy(() => void ++runs);
console.log(number(), number(), object(), object() === object(), nothing(), nothing(), runs);
