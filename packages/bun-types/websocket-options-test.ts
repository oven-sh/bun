// Type-level regression test for WebSocket options excess-property check.
// Verifies that object literals with `headers` compile when combined with
// `protocol`, `protocols`, or neither — without TS2353.
// Regression: https://github.com/oven-sh/bun/pull/31205

declare const url: string;
declare const wsHeaders: Record<string, string>;

// Headers only — must compile
const _ws1 = new WebSocket(url, { headers: wsHeaders });

// headers + protocol — must compile (was rejected before flatten)
const _ws2 = new WebSocket(url, { protocol: "vite-hmr", headers: wsHeaders });

// headers + protocols array — must compile (was rejected before flatten)
const _ws3 = new WebSocket(url, { protocols: ["a", "b"], headers: wsHeaders });

// No options — must still compile
const _ws4 = new WebSocket(url);

// Legacy string protocol form — must still compile
const _ws5 = new WebSocket(url, "vite-hmr");
