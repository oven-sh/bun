// rr-shapes-12.d.ts: piece 12's additions (original.js 6594..7188).
declare namespace RR {
  /**
   * What the user's getSnapshotBeforeUpdate answers (7013), WHERE IT MUST STAND IN A UNION: the bundle keeps it in `firstChild` (6971), a parameter that holds a Fiber,
   * the flags, an update queue and the event payloads at other times. given; ANYTHING (a scroll offset, mostly: a number); only carried: to
   * ClassInstance.__reactInternalSnapshotBeforeUpdate (7017) and from there to componentDidUpdate (7076). `any` there would swallow the union; leaving it out would be a
   * false statement about the variable. Opaque like HostObject: none of our shapes is assignable to SnapshotObject, so narrowing by assignment holds for the other
   * members; `any` goes in and this goes into `any` without a cast; at run time SnapshotObject must admit EVERY object.
   * THE SAME IDEA AS piece 2's ThrownInUnion, piece 5's HookStateInUnion, piece 8's Carried, piece 9's Given: ONE NAME IN rr-shapes.d.ts WOULD DO FOR THE FIVE.
   */
  interface SnapshotObject { readonly $$rrSnapshot?: never }
  type Snapshot = SnapshotObject | string | number | bigint | boolean | symbol | null | undefined;
}
