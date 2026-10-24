// rr-shapes-09.d.ts: piece 9's additions (original.js 4740..5228).
declare namespace RR {
  /**
   * ANYTHING, SPELLED SO THAT IT CAN STAND IN A UNION WITH OUR SHAPES. For a variable that the bundle reuses: a ReactNode (props.children | props.fallback) or a prop of the
   * user's (revealOrder) at one time, a Fiber at another. `any` | `unknown` there would swallow the union (narrowing by assignment off, every read by name); leaving them out
   * would be a false statement about the variable (<Suspense fallback="Loading"> stores a string to it). Same idea as HostObject: none of our shapes is assignable to the
   * object member, `any` is. At run time the object member must admit EVERY object (an element, a portal, an array, a function, garbage).
   */
  interface GivenObject { readonly $$rrGiven?: never }
  type Given = GivenObject | string | number | bigint | boolean | symbol | null | undefined;
}
