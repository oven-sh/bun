// A store under a private name is written as a store under a name is. It is none: the record that `Object.create(null)` makes for a maker lists the written names alone, at the top of a file, where a class declared behind the maker stores on it, and in a method.
// RUN: link
// CHECK: layout [[inAMethod]] {{*}}fields=[{key="kind" {{*}}{key="plain" {{*}}}]
// CHECK: layout [[atTheTop]] {{*}}fields=[{key="named" {{*}}}]
// CHECK: function {{*}}kind=Module
// CHECK: = NewObject layout=[[atTheTop]]
// CHECK: function {{*}}name="make"
// CHECK: = NewObject layout=[[inAMethod]]
const table = Object.create(null);
table.named = 1;
class Base {
  constructor(given) {
    return given;
  }
}
class Stamp extends Base {
  #mark = 1;
  static stamp(value) {
    new Stamp(table);
    table.#mark = value;
    return table.#mark;
  }
  static make(value) {
    const made = Object.create(null);
    made.plain = value;
    try {
      made.#mark = 2;
    } catch (error) {
      made.kind = error.constructor.name;
    }
    return made;
  }
}
export { Stamp, table };
