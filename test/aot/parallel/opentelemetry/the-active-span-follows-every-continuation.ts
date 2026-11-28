// The active span is part of the async context. Nothing in this program loads node:async_hooks.
Bun.otel.start({ exporters: [], instrumentations: [] });
const active = () => Bun.otel.activeSpan()?.name;

async function* numbers() {
  yield active();
  await 1;
  yield active();
}

async function work(turns: number) {
  const seen = [active()];
  for (let i = 0; i < turns; i++) await i;
  seen.push(active());
  seen.push(await new Promise(resolve => setTimeout(() => resolve(active()), 1)));
  seen.push(await new Promise(resolve => setImmediate(() => resolve(active()))));
  seen.push(await new Promise(resolve => process.nextTick(() => resolve(active()))));
  seen.push(await new Promise(resolve => queueMicrotask(() => resolve(active()))));
  seen.push(await Promise.resolve().then(active));
  seen.push(await Promise.reject(0).catch(active));
  for await (const name of numbers()) seen.push(name);
  seen.push(
    ...(await Promise.all([Bun.otel.span("inner", async () => (await 1, active())), (async () => active())()])),
  );
  return seen.join();
}

const begunBefore = (async () => {
  await Bun.sleep(5);
  return active();
})();
console.log(await Promise.all([1, 3, 2].map(turns => Bun.otel.span("work " + turns, () => work(turns)))));
console.log(await begunBefore, active());

async function entersLate() {
  await 1;
  using span = Bun.otel.span("late");
  await 1;
  return active();
}
const late = entersLate();
console.log(active(), await late, active());

{
  using outer = Bun.otel.span("outer");
  {
    using inner = Bun.otel.span("inner");
    console.log(active(), inner.parentSpanId === outer.spanId);
  }
  console.log(active());
}
console.log(active());
