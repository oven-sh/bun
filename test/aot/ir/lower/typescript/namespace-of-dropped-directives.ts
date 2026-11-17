// `bun run` drops "use asm" at the head of a namespace, and "use strict" with an escape, where types may follow them, and `import type a = ..`. A namespace of which nothing else is left makes no object.
// It keeps "use strict", and a string in parentheses or under a cast in front of it is no directive: such a namespace makes an object.

// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-COUNT-4: = NewObject
// CHECK-NOT: = NewObject

namespace Types {
  export type A = 1;
}
namespace UnderACast {
  "use asm" as any;
}
namespace WithAnEscape {
  "use\x20strict";
}
namespace Asm {
  "use asm";
}
namespace Several {
  "use asm";
  type A = 1;
  "use asm" as any;
}
namespace BehindAnAlias { // @ts-expect-error
  import type A = Types.A;
  "use asm";
}
namespace ExportedAlias { // @ts-expect-error
  export import type A = Types.A;
}
namespace OtherText {
  "use client" as any;
}
namespace Template {
  `use strict` as any;
}
namespace Strict {
  "use strict";
}
namespace InParentheses {
  ("use asm");
}
export const kept = [typeof OtherText, typeof Template, typeof Strict, typeof InParentheses];
