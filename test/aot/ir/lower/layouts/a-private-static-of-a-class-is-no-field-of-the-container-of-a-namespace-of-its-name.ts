// A class and a namespace of one name share one table of exports, and the class's static members stand in it, the private ones too, under the binder's own spelling. The layout of the namespace's object lists the names that have a value at the run. A private static is none of them.
// RUN: link
// CHECK: layout {{*}}kind=Container name="Level" {{*}}fields=[{key="prototype" declared={type=anything}}, {key="raise" declared={type=anything}}, {key="top" {{*}}}]
class Level {
  static #at = 1;
  static get #now() {
    return Level.#at;
  }
  static set #now(to: number) {
    Level.#at = to * 2;
  }
  static #twice(by: number) {
    return by * 2;
  }
  static raise(by: number) {
    Level.#now = Level.#now + Level.#twice(by);
    return Level.#now;
  }
}
namespace Level {
  export function top() {
    return Level.raise(1);
  }
}
export { Level };
