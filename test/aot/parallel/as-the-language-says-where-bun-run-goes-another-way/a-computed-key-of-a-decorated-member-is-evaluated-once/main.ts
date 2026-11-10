// compatibility.mdx, "Smaller differences". Under experimentalDecorators `bun run` and a plain executable write the expression of a computed key again at each place that
// names the member: where a field is assigned (for an instance field at every `new`) and where the member is decorated. What `tsc` emits keeps the key, and so does compiled code.
// `bun run`: static field other,a,value,a,mark:a . without a value other,a,mark:a . instance field a,mark:a, constructed other,a,value . method, static method, getter
// a,other,a,mark:a . two and one b,plain,a,first,c,second,a,mark:a,c,mark:c
const log: string[] = [];
function note<T>(word: T): T {
  log.push(String(word));
  return word;
}
function mark(_target: unknown, _key: string, _more?: unknown) {
  log.push("mark:" + _key);
}
function told(): string {
  return log.splice(0).join(",");
}
const K = {
  get a(): "a" {
    return note("a");
  },
  get b(): "b" {
    return note("b");
  },
  get c(): "c" {
    return note("c");
  },
};
class StaticField {
  @mark static [K.a]: unknown = note("value");
  static other = note("other");
}
console.log("static field    ", told());
class StaticFieldWithoutValue {
  @mark static [K.a]: unknown;
  static other = note("other");
}
console.log("without a value ", told());
class InstanceField {
  @mark [K.a]: unknown = note("value");
  other = note("other");
}
console.log("instance field  ", told());
new InstanceField();
console.log("  constructed   ", told());
class Method {
  @mark [K.a]() {}
  static other = note("other");
}
console.log("method          ", told());
class StaticMethod {
  @mark static [K.a]() {}
  static other = note("other");
}
console.log("static method   ", told());
class Getter {
  @mark get [K.a]() {
    return 1;
  }
  static other = note("other");
}
console.log("getter          ", told());
class Two {
  @mark static [K.a]: unknown = note("first");
  static [K.b]: unknown = note("plain");
  @mark static [K.c]: unknown = note("second");
}
console.log("two and one     ", told());
export {};
/* Output:
static field     a,other,value,mark:a
without a value  a,other,mark:a
instance field   a,mark:a
  constructed    other,value
method           a,other,mark:a
static method    a,other,mark:a
getter           a,other,mark:a
two and one      a,b,c,plain,first,second,mark:a,mark:c
*/
