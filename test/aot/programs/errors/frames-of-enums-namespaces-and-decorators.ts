// Prints the frames above a call made while an enum, a namespace or a decorated class is set up, and above the initializer of a decorated field.
// An executable lists the functions that the file declares, at the places of the calls.
const inThisFile = /frames-of-enums-namespaces-and-decorators/;
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
