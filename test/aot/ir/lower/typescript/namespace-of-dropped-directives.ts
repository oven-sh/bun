// `bun run` drops "use strict" and "use asm" at the head of a namespace, under casts and in parentheses too, and `import type a = ..`. A namespace of which nothing else is left makes no object.

// RUN: lower
// CHECK-LABEL: function {{*}}kind=Module
// CHECK-COUNT-2: = NewObject
// CHECK-NOT: = NewObject

namespace Types {
  export type A = 1;
}
namespace UnderACast {
  "use strict" as any;
}
namespace Asm {
  "use asm";
}
namespace Several {
  ("use strict");
  type A = 1;
  <any>"use asm";
}
namespace BehindAnAlias { // @ts-expect-error
  import type A = Types.A;
  "use strict";
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
export const kept = [typeof OtherText, typeof Template];
