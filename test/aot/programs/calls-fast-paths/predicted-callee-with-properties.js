// A closure that was given properties is still a closure of its function. Where the program gives properties to the closures of a function, the test for a predicted callee takes them too.
// IR= 1 ofAClosureWithProperties boolean = IsClosureOf v[0-9]+ function=f[0-9]+
// IR= 1 ofAClosureWithout boolean = IsClosureOf
const makers = {
  withProperties(f) {
    const made = function (n) {
      return f(n) + made.extra;
    };
    made.extra = 1;
    return made;
  },
  without(f) {
    return function (n) {
      return f(n) + 1;
    };
  },
};
const first = makers.withProperties(n => n * 2);
const second = makers.without(n => n * 2);

function ofAClosureWithProperties(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += first(i);
  return total;
}

function ofAClosureWithout(n) {
  let total = 0;
  for (let i = 0; i < n; i++) total += second(i);
  return total;
}

const held = [ofAClosureWithProperties, ofAClosureWithout];
console.log(held.map(f => f(5)).join(), first.extra, Object.keys(first).join());
first.extra = 10;
console.log(ofAClosureWithProperties(5));
