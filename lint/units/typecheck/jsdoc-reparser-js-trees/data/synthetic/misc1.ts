foo(); /** @deprecated */ var sameLine = 1;
/** @deprecated use two */
declare function dep(): void;
/** {@link dep} and @see dep */
export const y = 1;
namespace N.M { /** doc */ export const z = 1; }
/** on-paren */ (a);
const h = /** arrow */ x => x;
