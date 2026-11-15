"use strict";
// A callback of Object.keys(..).forEach() that is called directly, too, stores under other names.
class Counted {
  constructor(options) {
    const each = key => { this[key] = options[key]; };
    Object.keys(options).forEach(each);
    each("other");
  }
}
function lengths(o) {
  const r = {};
  const each = key => { r[key] = key.length; };
  Object.keys(o).forEach(each);
  each("another");
  return r;
}
for (let i = 0; i < 4; i++) {
  const counted = new Counted({ a: i, b: 2 }), r = lengths({ a: 1, bb: 2 });
  console.log(JSON.stringify(counted), "other" in counted, counted.a, JSON.stringify(r), r.another, r.bb);
}
