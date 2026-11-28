// Bytes that one more span holds: `CASE=<name> N=<count>`. The growth of the resident set after a full collection,
// which counts the JavaScript heap and native memory alike. MODE=off gives what the case holds without tracing.
import { anonymousRss, tracer } from "./tracing.ts";

const N = Number(process.env.N ?? 500_000);
const kept: unknown[] = new Array(N).fill(0);
const attributes = (i: number) => ({ "user.id": i, "http.route": "/users/:id", "cache.hit": true, "db.rows": i / 2 });
const cases: Record<string, (i: number) => unknown> = {
  "nothing (startup)": () => 0,
  "open span": () => tracer.startSpan("op"),
  "open span, 4 attributes": i => tracer.startSpan("op", { attributes: attributes(i) }),
  "active span around a suspended async function": i => {
    const { promise, resolve } = Promise.withResolvers<void>();
    tracer.startActiveSpan("op", { attributes: attributes(i) }, async span => {
      await promise;
      span.end();
    });
    return resolve;
  },
  "ended span waiting for export, 4 attributes": i => tracer.startSpan("op", { attributes: attributes(i) }).end(),
};

async function settledRss() {
  for (let i = 0; i < 3; i++) {
    Bun.gc(true);
    await Bun.sleep(300);
  }
  return anonymousRss();
}

if (!process.env.CASE) {
  console.log(JSON.stringify(Object.keys(cases)));
} else {
  const make = cases[process.env.CASE];
  tracer.startActiveSpan("warm up", span => span.end());
  const before = await settledRss();
  for (let i = 0; i < N; i++) kept[i] = make(i);
  const after = await settledRss();
  console.log(JSON.stringify({ bytes: (after - before) / kept.length, rss: before }));
}
process.kill(process.pid, "SIGKILL");
