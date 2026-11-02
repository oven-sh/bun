// Inside a namespace and an enum, a member of that name is no variable, and a `--define` whose value is the name reads the variable around them: a `const` of the file, and a parameter, a `var` and a function of a function.
// Flags: --define NAME=target --define ROOT=holder.value
declare const NAME: any, ROOT: any;
(globalThis as any).target = "the global";
(globalThis as any).holder = { value: "the global" };
const target = "the const of the file";
const holder = { value: "the member of the const of the file" };
namespace Space {
  export const target = "the member of the namespace";
  export const holder = { value: "the member of the namespace" };
  export const seen = [NAME, ROOT].join(", ");
}
enum Kind {
  target = "the member of the enum",
  seen = NAME,
}
function ofParameter(target: string): unknown {
  enum Kind {
    target = 1,
    seen = NAME as any,
  }
  return Kind.seen;
}
function ofVar(): unknown {
  var target = "the var";
  enum Kind {
    target = 1,
    seen = NAME as any,
  }
  return Kind.seen;
}
function ofFunction(): unknown {
  function target() {}
  enum Kind {
    target = 1,
    seen = typeof NAME as any,
  }
  return Kind.seen;
}
console.log(Space.seen, "|", Kind.seen, "|", ofParameter("the parameter"), "|", ofVar(), "|", ofFunction());

export {};
