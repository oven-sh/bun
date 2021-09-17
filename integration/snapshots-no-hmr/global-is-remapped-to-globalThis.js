export function test() {
  console.assert(globalThis === globalThis);
  return testDone(import.meta.url);
}
