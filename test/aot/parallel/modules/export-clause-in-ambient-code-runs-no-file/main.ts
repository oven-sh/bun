// An export clause in ambient code makes no code. An import whose names stand nowhere else is dropped, and its file does not run.
import { InNamespace } from "./in-namespace";
import { InExportedNamespace } from "./in-exported-namespace";
import { InModule } from "./in-module";
import { InNamedModule } from "./in-named-module";
import { InInnerNamespace } from "./in-inner-namespace";
import { InDeclaredPartOfNamespace } from "./in-declared-part-of-namespace";
import { Renamed } from "./renamed";
import { AsDefault } from "./as-default";
import { Value } from "./value";
import TheDefault from "./the-default";
import * as star from "./star";
import { Twice } from "./twice";
import { BesideOthers } from "./beside-others";
import { AlsoRead } from "./also-read";
import { OneOfTwo, other } from "./one-of-two";
import { Missing } from "./no-such-name";
import { fromRing } from "./ring";

declare namespace A {
  export { InNamespace };
}
export declare namespace B {
  export { InExportedNamespace };
}
declare module "c" {
  export { InModule };
}
declare module D {
  export { InNamedModule };
}
declare namespace E {
  namespace Inner {
    export { InInnerNamespace };
  }
}
namespace F {
  export declare namespace Inner {
    export { InDeclaredPartOfNamespace };
  }
}
declare namespace G {
  export { Renamed as Other, AsDefault as default, Value, TheDefault, star };
}
declare namespace H {
  export { Twice };
}
declare namespace H {
  export { Twice as Again };
}
declare namespace I {
  const own: BesideOthers;
  class Own {
    method(a: BesideOthers): void;
  }
  export { own, Own, BesideOthers, AlsoRead, OneOfTwo, Missing };
}
console.log("main", typeof F, typeof AlsoRead, other, fromRing);
