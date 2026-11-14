import _ from "lodash";
import fp from "lodash/fp";

const users = [
  { user: "barney", age: 36, active: true },
  { user: "fred", age: 40, active: false },
  { user: "pebbles", age: 1, active: true },
];
console.log(
  JSON.stringify([
    _.chunk([1, 2, 3, 4, 5], 2),
    _.groupBy(users, "active"),
    _.sortBy(users, ["active", u => -u.age]).map(u => u.user),
    _.partition(users, "active").map(part => part.length),
    _.keyBy(users, "user").fred.age,
  ]),
);
const object = { a: [{ b: { c: 3 } }] };
console.log(
  _.get(object, "a[0].b.c"),
  _.get(object, ["a", "1", "b"], "default"),
  JSON.stringify(_.set(_.cloneDeep(object), "a[1].x", 1)),
  JSON.stringify(_.merge({ a: [{ b: 2 }, { d: 4 }] }, { a: [{ c: 3 }, { e: 5 }] })),
  _.isEqual(object, _.cloneDeep(object)),
  JSON.stringify(_.omit({ a: 1, b: 2, c: 3 }, ["a", "c"])),
);
console.log(
  _.chain(users).filter("active").map("age").sum().value(),
  _.camelCase("Foo Bar--baz"),
  _.kebabCase("fooBarBaz"),
  _.startCase("__foo_bar"),
  _.uniqBy([2.1, 1.2, 2.3], Math.floor).join(),
  _.zipObject(["a", "b"], [1, 2]).b,
  _.range(0, 10, 3).join(),
  _.padStart("5", 3, "0"),
  _.truncate("hi-diddly-ho there, neighborino", { length: 12 }),
);
console.log(
  fp.flow(
    fp.map((n: number) => n * 2),
    fp.filter((n: number) => n > 2),
    fp.sum,
  )([1, 2, 3]),
  _.memoize((n: number) => n * 2)(4),
  _.curry((a: number, b: number, c: number) => a + b + c)(1)(2)(3),
  _.once(() => 5)(),
  JSON.stringify(_.countBy("mississippi")),
  _.isPlainObject(Object.create(null)),
  _.times(3, String).join(),
);
