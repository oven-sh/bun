// `let x = NaN` in front of a loop that hands on integers: the loop gets a copy behind a test of the first value for an int32, that test is decided at once, and the copy is cut again.
// The compiler then read ids from before the cut: it crashed in most builds, at no flags.
{
function f() {
  const a = [7];
  let x = NaN;
  let i = 0;
  while (i < a.length && (!x || x < 4)) x = a[i++];
  return [x, i];
}
console.log(f());
}
{
function f() {
  const a = [7];
  let x = NaN;
  for (let i = a.length - 1; i >= 0; i--) if (!x || a[i] < a[x]) x = i;
  return [x, a[x]];
}
console.log(f());
}
{
function f() {
  const a = [7];
  let x = NaN;
  let i = 0;
  while (i < a.length && (isNaN(x) || x < 4)) x = a[i++];
  return [x, i];
}
console.log(f());
}
