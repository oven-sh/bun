import { bench, run } from "../runner.mjs";

bench("JSON.stringify({hello: 'world'})", () => JSON.stringify({ hello: "world" }));

const otherUint8Array = new Uint8Array(1024);
bench("Uint8Array.from(otherUint8Array)", () => Uint8Array.from(otherUint8Array));

run();
