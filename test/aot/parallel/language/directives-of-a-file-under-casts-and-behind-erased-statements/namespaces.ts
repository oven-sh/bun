namespace Types {
  export type B = 1;
}
namespace UnderACast {
  "use strict" as any;
}
namespace Asm {
  "use asm";
}
namespace AsmUnderACast {
  "use asm" as any;
}
namespace Several {
  "use strict";
  "use asm";
  type A = 1;
  ("use strict");
}
namespace BehindAnAlias {
  // @ts-ignore
  import type A = Types.B;
  "use strict";
}
namespace ExportedAlias {
  // @ts-ignore
  export import type A = Types.B;
}
namespace ExportedAliasBesideCode {
  // @ts-ignore
  export import type A = Types.B;
  export const code = 1;
}
namespace OtherText {
  "first" as any;
}
namespace Template {
  `use strict` as any;
}
namespace BehindAnEmptyStatement {
  ;
  "use strict";
}
console.log(
  "namespaces:",
  // @ts-ignore
  [typeof UnderACast, typeof Asm, typeof AsmUnderACast, typeof Several, typeof BehindAnAlias, typeof ExportedAlias].join(),
  Object.keys(ExportedAliasBesideCode).join(),
  [typeof OtherText, typeof Template, typeof BehindAnEmptyStatement].join(),
);
