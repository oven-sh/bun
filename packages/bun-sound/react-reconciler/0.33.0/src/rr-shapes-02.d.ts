// rr-shapes-02.d.ts: piece 2's additions (original.js 1008..1488).
declare namespace RR {
  /**
   * What was thrown or rejected with, WHERE IT MUST STAND IN A UNION: a variable that holds a thenable's reason and, before or after, something of ours
   * (1436 1470 thenableState = thenable.reason; 1371 error = 0). `Thrown` is any and would swallow the union. Opaque like HostObject: none of our shapes is
   * assignable to ThrownObject, so narrowing by assignment holds; every object satisfies it; the primitives stand beside it because `throw 1` is legal.
   * A `Thrown` goes in, and this goes into a `Thrown`, without a cast.
   */
  interface ThrownObject { readonly $$rrThrown?: never }
  type ThrownInUnion = ThrownObject | string | number | boolean | bigint | symbol | null | undefined;
  /** What shallowEqual compares: props or a class's state, read by computed key. any */
  type Comparand = any;
  /** What a lazy's _init returns: a component type (5370, 1604, 2063) or a node (1699 1748 1810 2138). any */
  type LazyResult = any;
}
