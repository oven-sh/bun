// A conversion to a string has no place of its own in a stack trace: its caller is reported where the last operation in front of it stands. Here that is
// the store of a class declaration whose name a closure sees or the module exports.
function show(label) {
  const lines = String(new Error().stack).split("\n");
  const index = lines.findIndex(text => /at toString/.test(text));
  const found = /:(\d+):(\d+)\)?$/.exec(lines[index + 1] ?? "");
  console.log(label, found ? found[1] + ":" + found[2] : "none");
  return "text";
}
const id = (...values) => values.length;
class Base {}

export class Short extends Base {
  method() {}
}
`${{ toString: () => String(show("an exported class with a short name")) }}`;
export class LongerName extends Base {
  method() {}
}
`${{ toString: () => String(show("an exported class with a longer name")) }}`;
export class SixOnes extends Base {}
`${{ toString: () => String(show("an exported class without members")) }}`;
class ListedClass {
  [id(1)]() {}
}
`${{ toString: () => String(show("a class in a list of exports")) }}`;
export { ListedClass };
class SeenByClosure {
  size = 1;

  [id(1)]() {}
}
`${{ toString: () => String(show("a class that a closure sees")) }}`;
class SeenByNobody {
  size = 1;

  [id(1)]() {}
}
`${{ toString: () => String(show("a class that nobody else sees")) }}`;
export default class Chosen extends Base {
  method() {}
}
`${{ toString: () => String(show("the default export")) }}`;
export class WithStaticParts extends Base {
  static count = id(1);

  static {
    id(2);
  }
}
`${{ toString: () => String(show("an exported class with static parts")) }}`;

function inside() {
  id(0);
  class Inner {
    method() {}
  }
  `${{ toString: () => String(show("in a function: a short name")) }}`;
  class InnerLonger {
    method() {}
  }
  `${{ toString: () => String(show("in a function: a longer name")) }}`;
  class InnerFields {
    #hidden = 1;

    size = 2;
  }
  `${{ toString: () => String(show("in a function: fields alone")) }}`;
  class InnerItself {
    method() {
      return InnerItself;
    }
  }
  `${{ toString: () => String(show("in a function: only the class sees itself")) }}`;
  class InnerDerived extends (`${{ toString: () => String(show("in a function: in the heritage")) }}`, Base) {}
  for (const item of [1, 2]) {
    class InnerInLoop extends Base {
      constructor() {
        super();
        this.item = item;
      }
    }
    `${{ toString: () => String(show("in a loop")) }}`;
    id(() => InnerInLoop);
  }
  return () => [Inner, InnerLonger, InnerFields, InnerDerived];
}
inside();
function uses() {
  return SeenByClosure;
}
