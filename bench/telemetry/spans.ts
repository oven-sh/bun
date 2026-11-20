// CPU time of one operation, encoding and export included: `CASE=<name> N=<count>`. Prints nanoseconds.
import { anonymousRss, flush, tracer } from "./tracing.ts";

const N = Number(process.env.N ?? 500_000);
const cases: Record<string, (i: number) => unknown> = {
  "startSpan + end": () => tracer.startSpan("op").end(),
  "startSpan + 3 setAttribute + end": i => {
    const span = tracer.startSpan("op");
    span.setAttribute("a", i);
    span.setAttribute("b", "text");
    span.setAttribute("c", true);
    span.end();
  },
  "startSpan({ attributes: 3 }) + end": i => tracer.startSpan("op", { attributes: { a: i, b: "text", c: true } }).end(),
  "startActiveSpan + end": () => tracer.startActiveSpan("op", span => span.end()),
  "startActiveSpan > startSpan (2 spans)": () =>
    tracer.startActiveSpan("op", span => {
      tracer.startSpan("child").end();
      span.end();
    }),
  "startActiveSpan(async) + 2 await + end": () =>
    tracer.startActiveSpan("op", async span => {
      await 0;
      await 0;
      span.end();
    }),
};

if (!process.env.CASE) {
  console.log(JSON.stringify(Object.keys(cases)));
} else {
  let peakRss = 0;
  const operation = cases[process.env.CASE];
  // Flushing below the size of the queue keeps either side from getting ahead by dropping spans.
  async function run(count: number) {
    for (let i = 0; i < count;) {
      for (const end = i + 500; i < end; i++) {
        const result = operation(i);
        if (result) await result;
      }
      await flush();
      if (i % 20_000 === 0) peakRss = Math.max(peakRss, anonymousRss());
    }
  }
  await run(N / 10);
  const before = process.cpuUsage();
  await run(N);
  const { user, system } = process.cpuUsage(before);
  console.log(JSON.stringify({ ns: ((user + system) * 1000) / N, peakRss }));
}
process.exit(0);
