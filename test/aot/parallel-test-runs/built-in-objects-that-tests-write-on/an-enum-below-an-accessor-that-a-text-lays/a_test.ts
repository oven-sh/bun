import { test } from "bun:test";
const hits: unknown[] = [];
function make(): Record<string, unknown> {
  enum State {
    Ready,
    Done,
  }
  return State as unknown as Record<string, unknown>;
}
test("unseen code lays the accessor", () => {
  const lay = (0, eval)("(hits) => Object.defineProperty(Object.prototype, 'Ready', { configurable: true, get() { return 'above'; }, set(value) { hits.push(value); } })");
  let thrown = "nothing";
  try {
    lay(hits);
  } catch (error) {
    thrown = (error as Error).constructor.name;
  }
  const made = make();
  console.log(thrown, Object.keys(made).join(), String(made.Ready), hits.join());
  delete (Object.prototype as Record<string, unknown>).Ready;
});
