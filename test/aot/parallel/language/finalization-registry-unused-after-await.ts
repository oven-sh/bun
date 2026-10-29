// A local variable that is not used again keeps nothing alive across an `await`. A FinalizationRegistry that only such a variable holds is collected with the objects registered with it, and its callback never runs; one that is used after the wait is kept, and its callback runs. Plain Bun keeps both: there the variable lives in the scope object that the closures of the function share.
// Alone: it measures time, memory or what is collected, and that depends on what the compiler knows about the whole executable
function collectWhileNothingRuns(): Promise<void> {
  return new Promise(resolve =>
    setTimeout(() => {
      Bun.gc(true);
      resolve();
    }, 1),
  );
}
async function usedAfterTheWait(): Promise<string> {
  let tracked = 0;
  let collected = 0;
  const registry = new FinalizationRegistry(() => collected++);
  const track = (target: object) => {
    tracked++;
    registry.register(target, undefined);
  };
  for (let i = 0; i < 5; i++) track({ i });
  const kept = {};
  registry.register(kept, undefined, kept);
  for (let round = 0; round < 50 && collected < tracked; round++) await collectWhileNothingRuns();
  return `${collected} of ${tracked}, ${registry.unregister(kept)}`;
}
async function notUsedAfterTheWait(): Promise<string> {
  let tracked = 0;
  let collected = 0;
  const registry = new FinalizationRegistry(() => collected++);
  const track = (target: object) => {
    tracked++;
    registry.register(target, undefined);
  };
  for (let i = 0; i < 5; i++) track({ i });
  for (let round = 0; round < 50 && collected < tracked; round++) await collectWhileNothingRuns();
  return `${collected} of ${tracked}`;
}
console.log("used after the wait:", await usedAfterTheWait());
console.log("not used after the wait:", await notUsedAfterTheWait());
