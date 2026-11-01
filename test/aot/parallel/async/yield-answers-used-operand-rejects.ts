// The generator is stepped by hand, so all that may be sent in is known, and what the yield answers is used. Where the awaited operand rejects, the reason arrives at the yield to be thrown.
const lines: string[] = [];
async function* nothingSent(): AsyncGenerator<unknown, void, unknown> {
  try { const got = yield Promise.reject(new Error("rejected")); lines.push("got " + String(got)); } catch (e) { lines.push("caught " + typeof e + " " + (e instanceof Error) + " " + String(e)); }
  yield "behind";
}
{
  const generator = nothingSent();
  lines.push(JSON.stringify(await generator.next()));
  lines.push(JSON.stringify(await generator.next()));
}
async function* numbersSent(): AsyncGenerator<unknown, void, number> {
  let sum = 0;
  try { sum += yield Promise.reject(new Error("rejected too")); } catch (e) { lines.push("caught " + typeof e + " " + (e instanceof Error) + " " + String(e)); }
  sum += yield "behind";
  lines.push("sum " + sum);
}
{
  const generator = numbersSent();
  lines.push(JSON.stringify(await generator.next(1)));
  lines.push(JSON.stringify(await generator.next(2)));
}
async function* uncaught(): AsyncGenerator<unknown, void, unknown> {
  const got = yield Promise.reject(new RangeError("not caught inside"));
  lines.push("got " + String(got));
}
{
  const generator = uncaught();
  try { lines.push(JSON.stringify(await generator.next())); } catch (e) { lines.push("outside " + typeof e + " " + (e instanceof RangeError) + " " + String(e)); }
}
function thenThrows(v: any): any { return { then() { throw new Error("then threw " + v); } }; }
async function* thenThrowsAndIsCaught(): AsyncGenerator<any, any, any> {
  try { lines.push("got " + String(yield thenThrows(9))); } catch (e) { lines.push("caught " + typeof e + " " + (e instanceof Error) + " " + (typeof e === "object" ? (e as Error).message : "?")); }
  yield "behind";
}
{
  const generator = thenThrowsAndIsCaught();
  lines.push(JSON.stringify(await generator.next()));
  lines.push(JSON.stringify(await generator.next(1)));
}
async function* thenThrowsAndIsNotCaught(): AsyncGenerator<any, any, any> {
  lines.push("got " + String(yield thenThrows(8)));
  yield "behind";
}
{
  const generator = thenThrowsAndIsNotCaught();
  try { lines.push(JSON.stringify(await generator.next())); } catch (e) { lines.push("outside " + typeof e + " " + (e instanceof Error) + " " + (typeof e === "object" ? (e as Error).message : "?")); }
  lines.push(JSON.stringify(await generator.next(2)));
}
function thenRejects(v: any): any { return { then(_: unknown, no: (e: unknown) => void) { no(new RangeError("then rejected " + v)); } }; }
async function* rejects(): AsyncGenerator<any, any, any> {
  try { lines.push("got " + String(yield thenRejects(7))); } catch (e) { lines.push("caught " + typeof e + " " + (e instanceof RangeError) + " " + (typeof e === "object" ? (e as Error).message : "?")); }
}
{
  const generator = rejects();
  lines.push(JSON.stringify(await generator.next()));
}
console.log(lines.join("\n"));
