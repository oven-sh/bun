// rr-shapes-03.d.ts: piece 3's additions (original.js 1489..2218: the child reconciler).
declare namespace RR {
  /** What createChildReconciler (1525) returns: reconcileChildFibers | mountChildFibers. birth 2198 */
  type ChildReconciler = (returnFiber: Fiber, currentFirstChild: Fiber | null, newChild: ReactNode, lanes: Lanes) => Fiber | null;
  /** birth 1543 mapRemainingChildren: the old children by key, or by index where they have no key */
  type ExistingChildren = Map<string | number, Fiber>;
  /**
   * given: what the children's own iterator function answers (RR.IteratorFn, run at 2158) and what its next() answers. The library's Iterator<ReactNode> is assignable to it.
   * ONE shape in place of the library's union of two. The engine's own iterators write value, then done. Both optional, because a hand-written iterator may
   * answer { done: true } or { value: x }: the bundle reads both members and tests `done` for truth only. No shape of ours has a member in common with it,
   * so narrowing by assignment holds in `step` (1953), which holds one of these, then a Fiber | null.
   */
  interface ChildIteratorResult { value?: ReactNode; done?: boolean }
  interface ChildIterator { next(): ChildIteratorResult }
}
