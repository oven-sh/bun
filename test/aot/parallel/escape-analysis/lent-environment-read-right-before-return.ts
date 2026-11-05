// An environment that is kept in the frame is lent to a call on a seldom-taken path, and the function reads it once more right before it returns. The build checks its proofs at run time.
// Flags: --aot-testing=CheckProofsAtRunTime
interface O5 { inner: number }
type Link<T> = { value: T; next: Link<T> | null };
function f(start: number) {
  let tally = start;
  const list: O5[] = [{ inner: -3 }];
  (list as any)[0] = 1073741824;
  const arrived = list[0];
  [1, 2].forEach(step => { tally += step; });
  const link: Link<O5> = { value: arrived, next: { value: arrived, next: null } };
  { const later = () => { tally += 3; arrived; }; const before = tally; later(); tally += before; }
  return tally;
}
for (let turn = 0; turn < 2; turn++) console.log(f(0));
