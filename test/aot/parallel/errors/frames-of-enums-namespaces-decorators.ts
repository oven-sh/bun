// Prints the frames above a call made while an enum, a namespace or a decorated class is set up, and above the initializer of a decorated field.
// An executable lists the functions that the file declares, at the places of the calls.
const inThisFile = /frames-of-enums-namespaces-decorators/;
let frames = "";
function mark(): number {
  frames = String(new Error("mark").stack)
    .split("\n")
    .filter(line => inThisFile.test(line))
    .map(line => /^\s*at (.*?) ?\(?[^ ()]*:(\d+:\d+)\)?$/.exec(line)!)
    .map(found => `${found[1]}@${found[2]}`)
    .join(" < ");
  return 1;
}
function show(label: string, run: () => unknown) {
  frames = "";
  run();
  console.log(label, "|", frames);
}
function declaresEnum() {
  enum Kind {
    First = 1,
    Second = mark(),
    Third = 3,
  }
  return Kind.Third;
}
namespace Settings {
  export const first = 1;
  export const second = mark();
  export const third = 3;
}
const framesOfNamespace = frames;
namespace Outer {
  export namespace Inner {
    export const value = mark();
  }
}
const framesOfInnerNamespace = frames;
function marksMethod(_target: unknown, _context: ClassMethodDecoratorContext) {
  mark();
}
function marksClass(_target: unknown, _context: ClassDecoratorContext) {
  mark();
}
function marksField(_target: undefined, _context: ClassFieldDecoratorContext) {
  mark();
}
function makesDecorator() {
  mark();
  return function (_target: unknown, _context: ClassMethodDecoratorContext) {};
}
function declaresDecoratedMethod() {
  class Service {
    first() {}
    @marksMethod
    run() {}
  }
  return Service;
}
function declaresDecoratedClass() {
  @marksClass
  class Service {
    run() {}
  }
  return Service;
}
function declaresDecoratedField() {
  class Service {
    @marksField
    size = 1;
  }
  return Service;
}
function declaresDecoratorThatIsCalled() {
  class Service {
    @makesDecorator()
    run() {}
  }
  return Service;
}
function keepsField(_target: undefined, _context: ClassFieldDecoratorContext) {}
class FieldWithoutDecorator {
  size = mark();
}
class DecoratedField {
  @keepsField
  size = mark();
}
class DecoratedFieldAndConstructor {
  @keepsField
  size = mark();
  constructor() {
    this.size++;
  }
}
show("a member of an enum", declaresEnum);
console.log("a statement of a namespace |", framesOfNamespace);
console.log("a statement of a namespace in a namespace |", framesOfInnerNamespace);
show("a decorator of a method", declaresDecoratedMethod);
show("a decorator of a class", declaresDecoratedClass);
show("a decorator of a field", declaresDecoratedField);
show("a call that makes a decorator", declaresDecoratorThatIsCalled);
show("a field of a class without decorators", () => new FieldWithoutDecorator());
show("a decorated field", () => new DecoratedField());
show("a decorated field of a class with a constructor", () => new DecoratedFieldAndConstructor());
/* Output:
a member of an enum | mark@6:23 < declaresEnum@22:14 < show@16:3 < @96:1
a statement of a namespace | mark@6:23 < @29:25
a statement of a namespace in a namespace | mark@6:23 < @35:26
a decorator of a method | mark@6:23 < marksMethod@40:3 < declaresDecoratedMethod@56:5 < show@16:3 < @99:1
a decorator of a class | mark@6:23 < marksClass@43:3 < declaresDecoratedClass@61:3 < show@16:3 < @100:1
a decorator of a field | mark@6:23 < marksField@46:3 < declaresDecoratedField@70:5 < show@16:3 < @101:1
a call that makes a decorator | mark@6:23 < makesDecorator@49:3 < declaresDecoratorThatIsCalled@76:6 < show@16:3 < @102:1
a field of a class without decorators | mark@6:23 < <anonymous>@103:53 < show@16:3 < @103:1
a decorated field | mark@6:23 < <anonymous>@104:33 < show@16:3 < @104:1
a decorated field of a class with a constructor | mark@6:23 < new DecoratedFieldAndConstructor@92:14 < <anonymous>@105:63 < show@16:3 < @105:1
*/
