// Each function is stored under a name of its own, behind a call that always throws. What other objects hold under those names is bound.
function add(n) {
  return n + 1;
}
const double = n => n * 2;
function negate(n) {
  return -n;
}

function show(bind, holder) {
  try {
    const bound = bind(holder);
    console.log(bound.name, bound.length, bound(20));
  } catch (error) {
    console.log(error.constructor.name);
  }
}
const bindFirst = holder => holder.first.bind(null);
const bindSecond = holder => holder.second.bind(null, 1);
const bindThird = holder => holder.third.bind(holder);

try {
  BigInt64Array();
  registry.first = add;
} catch (error) {
  console.log(error.constructor.name);
}
try {
  new Symbol();
  registry.second = double;
} catch (error) {
  console.log(error.constructor.name);
}
try {
  BigInt64Array();
  registry[process.env.KEY_OF_THE_THIRD] = negate;
} catch (error) {
  console.log(error.constructor.name);
}

const given = JSON.parse(process.env.GIVEN ?? '{ "first": 1, "second": "two", "third": null }');
queueMicrotask(() => {
  for (const bind of [bindFirst, bindSecond, bindThird]) show(bind, given);
  given.first = given.second = given.third = Math.max;
  for (const bind of [bindFirst, bindSecond, bindThird]) show(bind, given);
});
