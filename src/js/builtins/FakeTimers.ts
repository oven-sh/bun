// The same object @sinonjs/fake-timers replaces `performance` with.
export function createPerformance(original: object, now: Function, timeOrigin: number) {
  const fake: Record<string, unknown> = { __proto__: null };
  for (const name of $Object.$getOwnPropertyNames($getPrototypeOf(original) ?? {})) {
    fake[name] = name.startsWith("getEntries") ? () => [] : () => {};
  }
  fake.mark = (name: string) => ({ name, entryType: "mark", startTime: 0, duration: 0 });
  fake.measure = (name: string) => ({ name, entryType: "measure", startTime: 0, duration: 100 });
  fake.now = now;
  fake.timeOrigin = timeOrigin;
  return fake;
}
