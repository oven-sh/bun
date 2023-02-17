import { run, bench } from "../node_modules/mitata/src/cli.mjs";

const encoder = new TextEncoder();

const buffer = new Uint8Array(1024);
bench("encodeInto", () => {
  encoder.encodeInto("Hello World!", buffer);
});

await run();
