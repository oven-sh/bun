// An array of five literals under `as const` whose members hold strings, booleans and null.
declare const console: { log(...values: unknown[]): void };
const MODES = [
  { name: "ws", secure: false, proxy: null },
  { name: "wss", secure: true, proxy: null },
  { name: "wss via http:// proxy", secure: true, proxy: "http" },
  { name: "wss via https:// proxy", secure: true, proxy: "https" },
  { name: "ws via https:// proxy", secure: false, proxy: "https" },
] as const;
for (const mode of MODES) console.log(mode.name, mode.secure, mode.proxy);
