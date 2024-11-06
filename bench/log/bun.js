import { bench, run } "../runner.mjs";

bench("console.log('hello')", () => console.log("hello"));
bench("console.log({ hello: 'object' })", () => console.log({ hello: "object" }));
await run();
