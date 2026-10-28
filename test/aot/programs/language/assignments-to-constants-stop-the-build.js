// Each function assigns to a `const` or `using` binding in another way. None of them is ever called.
function never() {
  const assigned = Math.random();
  assigned = 1;
  const literal = 1;
  literal = 2;
  const added = Math.random();
  added += 1;
  const defaulted = Math.random();
  defaulted ||= 1;
  const incremented = Math.random();
  incremented++;
  const decremented = Math.random();
  --decremented;
  const element = Math.random();
  [element] = [1];
  const rest = Math.random();
  [...rest] = [1];
  const shorthand = Math.random();
  ({ shorthand } = { shorthand: 1 });
  const renamed = Math.random();
  ({ from: renamed = 1 } = {});
  const key = Math.random();
  for (key in { a: 1 });
  const item = Math.random();
  for (item of [1]);
  const part = Math.random();
  for ([part] of [[1]]);
  for (const index = 0; index < 1; index++);
  for (const each of [1]) each = 2;
  const wrapped = Math.random();
  // prettier-ignore
  (wrapped) = 1;
  const captured = Math.random();
  const later = () => {
    captured = 1;
  };
  const caught = Math.random();
  try {
    caught = 1;
  } catch {}
  const unreachable = Math.random();
  if (false) unreachable = 1;
  early = 1;
  const early = Math.random();
  using resource = { [Symbol.dispose]() {} };
  resource = 1;
  return later;
}
async function neverAwaited() {
  await using awaited = { [Symbol.asyncDispose]() {} };
  awaited = 1;
}
const outermost = Math.random();
if (outermost > 1) outermost = 1;
console.log("ran");
