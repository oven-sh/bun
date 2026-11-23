// `bun run` leaves a name in its dead zone out only of what it hands to `simplify_unused_expr`: here the two expression statements of `statement`.
// What opens the head of a `for` and the operands of `delete` and of a `void` whose value is taken it leaves as they are written: the name is read, and the read is tested.
// A `void` of which it could leave everything out is `undefined` to it.
// Each function is looked for by itself: nothing here hangs on the order in which they are printed. No `Return` stands in front of what is looked for: it lies in that function.
// RUN(HEAD): lower
// HEAD-LABEL: function {{*}}name="head"
// HEAD-NOT: Return
// HEAD: = CheckInitialized {{*}}name="late"
// RUN(TAKEN): lower
// TAKEN-LABEL: function {{*}}name="takenVoid"
// TAKEN-NOT: Return
// TAKEN: [[late]] = CheckInitialized {{*}}name="late"
// TAKEN-NEXT: [[called]] = Call {{*}}calleeName="flag"
// TAKEN-NEXT: = StrictEq [[late]], [[called]]
// RUN(UPDATE): lower
// UPDATE-LABEL: function {{*}}name="update"
// UPDATE-NOT: Return
// UPDATE: = CheckInitialized {{*}}name="late"
// RUN(DELETED): lower
// DELETED-LABEL: function {{*}}name="deleted"
// DELETED-NOT: Return
// DELETED: = CheckInitialized {{*}}name="late"
// RUN(STATEMENT): lower
// STATEMENT-LABEL: function {{*}}name="statement"
// STATEMENT-NOT: CheckInitialized
// STATEMENT: = Call {{*}}calleeName="flag"
// STATEMENT-NOT: CheckInitialized
// STATEMENT: Return
// RUN(WHOLE): lower
// WHOLE-LABEL: function {{*}}name="wholeVoid"
// WHOLE-NOT: CheckInitialized
// WHOLE: Return

export function head(flag) {
  for (late; flag; ) break;
  let late = flag;
  return () => late;
}
export function takenVoid(flag) {
  const taken = void (late === flag());
  let late = flag;
  return () => [late, taken];
}
export function update(flag) {
  for (; flag(); void (late === flag())) {}
  let late = flag;
  return () => late;
}
export function deleted(flag) {
  const taken = delete (late && flag);
  let late = flag;
  return () => [late, taken];
}
export function statement(flag) {
  late;
  void (late === flag());
  let late = flag;
  return late;
}
export function wholeVoid(flag) {
  const taken = void (late === flag);
  let late = flag;
  return [late, taken];
}
