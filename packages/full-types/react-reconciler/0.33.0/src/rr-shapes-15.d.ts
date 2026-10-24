// rr-shapes-15.d.ts: piece 15's additions (original.js 8355..8984).
declare namespace RR {
  /**
   * The work lists of the test selectors. births 8651 (matchSelector) 8732 (findPaths), and 11432 in piece 20: fiber, selectorIndex, fiber, selectorIndex ..
   * (as ForkStackEntry | IdStackEntry | ConcurrentQueuesEntry: an array that alternates). The reads take a cast each: nothing in the bundle tests what came out.
   */
  type SelectorStackEntry = Fiber | number;
}
