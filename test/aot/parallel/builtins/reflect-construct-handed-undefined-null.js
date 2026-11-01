// Reflect.construct takes an object for its list of arguments and throws a TypeError for anything else. Function.prototype.apply takes undefined and null for an empty list.
function attempt(make) {
  try {
    return JSON.stringify(make());
  } catch (error) {
    return error.constructor.name;
  }
}
class Point {
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }
}
function Plain(x) {
  this.x = x;
}
function Target() {}
function make(maker, options) {
  return Reflect.construct(maker, options.list);
}
function handOn(list) {
  return Reflect.construct(Point, list);
}
let nothing;
const none = null;
const like = { length: 2, 0: 7, 1: 8 };
for (let turn = 0; turn < 2; turn++) {
  console.log(attempt(() => make(Point, {})), attempt(() => make(Point, { list: null })), attempt(() => make(Point, { list: [1] })));
  console.log(attempt(() => Reflect.construct(Point, undefined)), attempt(() => Reflect.construct(Point, null)), attempt(() => Reflect.construct(Point, nothing)), attempt(() => Reflect.construct(Point, none)));
  console.log(attempt(() => Reflect.construct(Plain, undefined)), attempt(() => Reflect.construct(Plain, null, Target)), attempt(() => Reflect.construct(Plain, nothing, Plain)), attempt(() => Reflect.construct(Point, undefined, Point)));
  console.log(attempt(() => Reflect.construct(Point, 1)), attempt(() => Reflect.construct(Point, "ab")), attempt(() => Reflect.construct(Point)), attempt(() => Reflect.construct(Point, true)));
  console.log(attempt(() => Reflect.construct(Point, [])), attempt(() => Reflect.construct(Point, [1, 2, 3])), attempt(() => Reflect.construct(Point, like)), attempt(() => Reflect.construct(Point, {})));
  console.log(attempt(() => handOn([3])), attempt(() => handOn(undefined)), attempt(() => handOn(null)), attempt(() => handOn(like)), attempt(() => handOn(5)));
  console.log(attempt(() => Reflect.construct(Point, nothing).x));
  console.log(attempt(() => Math.max.apply(null, undefined)), attempt(() => Math.max.apply(null, null)), attempt(() => Reflect.apply(Math.max, null, undefined)), attempt(() => Reflect.apply(Math.max, null, null)));
}
