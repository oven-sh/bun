// Build prints: 1 x warn: TS100150: Could not resolve: "./absent.mjs"
const seen = [];
const note = line => {
  seen.push(line);
  if (seen.length < 2) return;
  console.log(seen.sort().join("\n"));
  process.exit();
};
const good = new Worker(new URL("./good.js", import.meta.url).href);
good.onmessage = event => note(`good says ${event.data}`);
good.onerror = () => note("good fails");
const bad = new Worker(new URL("./bad.js", import.meta.url).href);
bad.onmessage = event => note(`bad says ${event.data}`);
bad.onerror = event => note(`bad fails: ${String(event.message).includes("absent.mjs")}`);
