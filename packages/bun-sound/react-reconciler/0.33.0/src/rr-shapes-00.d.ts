// rr-shapes-00.d.ts: piece 0's additions (original.js 1..492).
declare namespace RR {
  /** What getIteratorFn (141) hands out: the children's own [Symbol.iterator] | "@@iterator". given. The caller runs it by .call(children) (2158). */
  type IteratorFn = (this: ReactNode) => Iterator<ReactNode>;
  /**
   * What may stand where an element's type stands BEFORE it is known to be one: `any`, so NEVER IN A UNION. It is what getComponentNameFromType (149) takes:
   * 5416 gives it what a lazy resolved to when that is NO component (a number, garbage: React's own error 306 is made of the answer), 8716 a selector's value,
   * 196 what a lazy's _init answers. RR.ElementType there would be false of exactly the values the function is called for.
   */
  type AnyElementType = any;
}
