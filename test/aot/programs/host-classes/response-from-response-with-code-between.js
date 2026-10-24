// Between the read of `body` and the construction stands code that the compiler cannot look through: a call of a function that is not inlined, an await, a yield.
const log = [];
function initFor(response, depth) {
  if (depth > 0) return initFor(response, depth - 1);
  log.push("initFor");
  return { status: response.status + 1, headers: { "x-made": "by a call" } };
}
function same(response, depth) {
  if (depth > 0) return same(response, depth - 1);
  log.push("same");
  return response;
}
export function withCall(first) {
  return new Response(first.body, initFor(first, 3));
}
export function withCallOfTheSame(first) {
  return new Response(first.body, same(first, 3));
}
export async function withAwait(first) {
  return new Response(first.body, await Promise.resolve(first));
}
export function* withYield(first) {
  return new Response(first.body, yield first.status);
}
export function withNothing(first) {
  return new Response(first.body, first);
}
const make = () => new Response("text", { status: 201, headers: { "x-first": "1" } });
async function show(label, response) {
  console.log(label, response.status, response.headers.get("x-first"), response.headers.get("x-made"), JSON.stringify(await response.text()));
}
await show("a call", withCall(make()));
await show("a call that gives the same Response", withCallOfTheSame(make()));
await show("an await", await withAwait(make()));
const first = make();
const generator = withYield(first);
console.log("yielded", generator.next().value);
await show("a yield", generator.next(first).value);
await show("nothing", withNothing(make()));
console.log(log.join());
