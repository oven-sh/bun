// Prints what is there at run time of a namespace that holds nothing but types and has a dotted name, or a comment that is kept: no object and no export, as in what TypeScript's compiler emits.
import * as comment from "./comment";
import * as defaultExport from "./default-export";
import * as exported from "./exported";

namespace Typed.Inner {
  export type Kind = number;
}
namespace Empty.Inner {}
namespace Deep.Middle.Inner {}
namespace Noted {
  /*! kept */
}
namespace Filled.Inner {
  export type Kind = number;
  export const held: Kind = 2;
}
namespace Later.Inner {
  export type Kind = number;
}
namespace Later {
  export const held: Inner.Kind = 3;
}

const held: Typed.Inner.Kind = 1;
console.log(held, JSON.stringify(Filled), JSON.stringify(Later));
// @ts-ignore
console.log(typeof Typed, typeof Empty, typeof Deep, typeof Noted);
console.log(Object.keys(exported), Object.keys(defaultExport), Object.keys(comment));
/* Output:
1 {"Inner":{"held":2}} {"held":3}
undefined undefined undefined undefined
[ "Filled", "beside" ] [] [ "beside" ]
*/
