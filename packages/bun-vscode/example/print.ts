// Run like `/Users/ali/code/bun/build/release/bun --preload=./bug-preload.js --watch print.ts`
// to see this and have Cursor (or other editor llm) fix it.

await Bun.sleep(1000);
await Bun.sleep(1000);

console.log(Math.max(1, 2));
