function held<T>(value: T) { return { value, [Symbol.dispose]() { log.push("disposed"); } }; }
const log: string[] = [];
const spy = { mockImplementation<T>(f: T) { return held(f); } };
function spyOn() { return spy; }
async function drive(quick: boolean): Promise<string> {
  if (quick) return "quick";
  using first = spyOn().mockImplementation(async (outcome: string) => { calls.push(outcome); await whenQueued.promise; return calls.length; });
  const calls: string[] = [];
  const whenQueued = Promise.withResolvers<void>();
  let queuedAt = 0;
  using second = spyOn().mockImplementation((at: number) => { queuedAt = at; whenQueued.resolve(); });
  const pending = first.value("a");
  second.value(5);
  return (await pending) + ":" + queuedAt + ":" + calls.join();
}
drive(true).then(console.log); drive(false).then(v => console.log(v, log.join()));
