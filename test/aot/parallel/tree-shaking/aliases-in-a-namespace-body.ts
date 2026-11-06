// An `import a = b.c` in a namespace body is code only if a value reads `a`: one that only types name, or that nothing names, reads nothing of its root.
namespace Types {
  export type Count = number;
  export namespace Inner {
    export type Name = string;
  }
}
declare namespace Declared {
  type Flag = boolean;
}

namespace OnlyTypes {
  import Count = Types.Count;
  import Flag = Declared.Flag;
  export const count: Count = 1;
  export const flag: Flag = true;
}

namespace Chain {
  import Name = Inner.Name;
  import Inner = Types.Inner;
  export const name: Name = "chain";
}

// `Late` has no object yet when this body runs.
namespace NothingNamesIt {
  import late = Late.value;
  export const ran = "ran";
}

namespace Outer {
  import Inner = Types.Inner;
  export namespace Nested {
    import Name = Inner.Name;
    export const name: Name = "nested";
  }
}

namespace Late {
  export const value = 2;
  export function twice() {
    return value * 2;
  }
}

namespace ReadByValues {
  import value = Late.value;
  import twice = Late.twice;
  export import kept = Late.value;
  export const sum = value + twice();
  export function later() {
    return value;
  }
}

console.log(OnlyTypes.count, OnlyTypes.flag, Chain.name, NothingNamesIt.ran, Outer.Nested.name);
console.log(ReadByValues.sum, ReadByValues.later(), ReadByValues.kept);
