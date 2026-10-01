/** doc */
export function f(/** p */ a: number) {}
/**
 * @deprecated use g
 */
export const x = 1, /** y */ y = 2;
/** see {@link f} */
export class C {
  /** m */ m() {}
  /** @see f */
  p = 1;
}
/** paren */ (f)(1);
/** arrow */ const h = /** inner */ (a: number) => a;
const k = /** simple */ b => b;
interface I { /** sig */ (): void; /** prop */ a: number }
/** eof */
