// For maximum effect, make sure to clear your DNS cache before running this
//
// To clear your DNS cache on macOS:
//   sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder
//
// To clear your DNS cache on Linux:
//   sudo systemd-resolve --flush-caches && sudo killall -HUP systemd-resolved
//
// To clear your DNS cache on Windows:
//   ipconfig /flushdns
//
const url = new URL(process.argv.length > 2 ? process.argv.at(-1) : "https://bun.sh");
const hostname = url.hostname;
const port = url.port ? parseInt(url.port, 10) : url.protocol === "https:" ? 443 : 80;

if (typeof globalThis.Bun?.dns?.prefetch === "function") {
  Bun.dns.prefetch(hostname, port);
}

// Delay one second to make sure the DNS prefetch has time to run
await new Promise(resolve => setTimeout(resolve, 1000));

const start = performance.now();
const promises = [];

// Now let's fetch 20 times to see if the DNS prefetch has worked
for (let i = 0; i < 20; i++) {
  promises.push(fetch(url, { redirect: "manual", method: "HEAD" }));
}

await Promise.all(promises);

const end = performance.now();
console.log("fetch() took", (end - start) | 0, "ms");

if (typeof globalThis.Bun?.dns?.getCacheStats === "function") {
  console.log("DNS cache stats", Bun.dns.getCacheStats());
}
