import "./nothing.mjs";
globalThis.ran.push("awaits-at-top-level/root.mjs");
await 1;
