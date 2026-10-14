import { bench, run } from "../runner.mjs";

// pure JS implementation will optimze this out
bench("new Headers", function () {
  return new Headers();
});

var big = new Headers({
  "Content-Type": "text/plain",
  "Content-Length": "123",
  hello: "there",
  "X-Custom-Header": "Hello World",
  "X-Another-Custom-Header": "Hello World",
  "X-Yet-Another-Custom-ader": "Hello World",
  "X-Yet-Another-Custom-Heder": "Hello World",
  "X-Yet-Another-Custom-Heade": "Hello World",
  "X-Yet-Another-Custom-Headz": "Hello Worlda",
});

bench("new Headers([])", () => {
  return new Headers([]);
});

bench("new Headers({})", () => {
  return new Headers({});
});

bench("new Headers(object)", () => {
  return new Headers({
    "Content-Type": "text/plain",
    "Content-Length": "123",
    "User-Agent": "node-fetch/1.0",
  });
});

bench("new Headers(hugeObject)", () => {
  return new Headers({
    "Accept": "123",
    "Accept-Charset": "123",
    "Accept-Language": "123",
    "Accept-Encoding": "123",
    "Accept-Ranges": "123",
    "Access-Control-Allow-Credentials": "123",
    "Access-Control-Allow-Headers": "123",
    "Access-Control-Allow-Methods": "123",
    "Access-Control-Allow-Origin": "123",
    "Access-Control-Expose-Headers": "123",
    "Access-Control-Max-Age": "123",
    "Access-Control-Request-Headers": "123",
    "Access-Control-Request-Method": "123",
    "Age": "123",
    "Authorization": "123",
    "Cache-Control": "123",
    "Connection": "123",
    "Content-Disposition": "123",
    "Content-Encoding": "123",
    "Content-Language": "123",
    "Content-Length": "123",
    "Content-Location": "123",
    "Content-Security-Policy": "123",
    "Content-Security-Policy-Report-Only": "123",
    "Content-Type": "123",
    "Content-Range": "123",
    "Cookie": "123",
    "Cookie2": "123",
    "Cross-Origin-Embedder-Policy": "123",
    "Cross-Origin-Embedder-Policy-Report-Only": "123",
    "Cross-Origin-Opener-Policy": "123",
    "Cross-Origin-Opener-Policy-Report-Only": "123",
    "Cross-Origin-Resource-Policy": "123",
    "Date": "123",
    "DNT": "123",
    "Default-Style": "123",
    "ETag": "123",
    "Expect": "123",
    "Expires": "123",
    "Host": "123",
    "If-Match": "123",
    "If-Modified-Since": "123",
    "If-None-Match": "123",
    "If-Range": "123",
    "If-Unmodified-Since": "123",
    "Keep-Alive": "123",
    "Last-Event-ID": "123",
    "Last-Modified": "123",
    "Link": "123",
    "Location": "123",
    "Origin": "123",
    "Ping-From": "123",
    "Ping-To": "123",
    "Purpose": "123",
    "Pragma": "123",
    "Proxy-Authorization": "123",
    "Range": "123",
    "Referer": "123",
    "Referrer-Policy": "123",
    "Refresh": "123",
    "Report-To": "123",
    "Sec-Fetch-Dest": "123",
    "Sec-Fetch-Mode": "123",
    "Sec-WebSocket-Accept": "123",
    "Sec-WebSocket-Extensions": "123",
    "Sec-WebSocket-Key": "123",
    "Sec-WebSocket-Protocol": "123",
    "Sec-WebSocket-Version": "123",
    "Server-Timing": "123",
    "Service-Worker": "123",
    "Service-Worker-Allowed": "123",
    "Service-Worker-Navigation-Preload": "123",
    "Set-Cookie": "123",
    "Set-Cookie2": "123",
    "SourceMap": "123",
    "TE": "123",
    "Timing-Allow-Origin": "123",
    "Trailer": "123",
    "Transfer-Encoding": "123",
    "Upgrade": "123",
    "Upgrade-Insecure-Requests": "123",
    "User-Agent": "123",
    "Vary": "123",
    "Via": "123",
    "X-Content-Type-Options": "123",
    "X-DNS-Prefetch-Control": "123",
    "X-Frame-Options": "123",
    "X-SourceMap": "123",
    "X-XSS-Protection": "123",
    "X-Temp-Tablet": "123",
  });
});

bench("Header.get", function () {
  return big.get("Content-Type");
});

bench("Header.set (standard)", function () {
  return big.set("Content-Type", "text/html");
});

bench("Header.set (non-standard)", function () {
  return big.set("X-My-Custom", "text/html123");
});

if (big.toJSON)
  bench("Headers.toJSON", function () {
    return big.toJSON();
  });

bench("Object.fromEntries(headers.entries())", function () {
  return Object.fromEntries(big.entries());
});

bench("Object.fromEntries(headers)", function () {
  return Object.fromEntries(big);
});

// One name that repeats. A repeated name holds one joined value, so each
// append to it does a join. The cases go from a short joined value to a long one.
function appendRepeated(name, value, count) {
  const headers = new Headers();
  for (let i = 0; i < count; i++) headers.append(name, value);
  return headers;
}

const accept = "text/html,application/xhtml+xml";
const chunk = Buffer.alloc(98, "v").toString();
// The same characters in a 16-bit string.
const chunk16 = Buffer.from(chunk, "utf16le").toString("utf16le");
const pairs = Array.from({ length: 60 }, () => ["x-custom", chunk]);
const longCookie = Buffer.alloc(6000, "c").toString();
const withLongCookie = new Headers({ cookie: longCookie, accept, host: "example.com" });

bench("headers.append x2 (same name, 64 B joined)", () => appendRepeated("x-custom", accept, 2));
bench("headers.append x10 (same name, 328 B joined)", () => appendRepeated("x-custom", accept, 10));
bench("headers.append x10 (accept, 328 B joined)", () => appendRepeated("accept", accept, 10));
bench("headers.append x20 (same name, 2 KB joined)", () => appendRepeated("x-custom", chunk, 20));
bench("headers.append x40 (same name, 4 KB joined)", () => appendRepeated("x-custom", chunk, 40));
bench("headers.append x80 (same name, 8 KB joined)", () => appendRepeated("x-custom", chunk, 80));
bench("headers.append x80 (same name, 8 KB joined, 16-bit values)", () => appendRepeated("x-custom", chunk16, 80));
bench("headers.append x1000 (same name, 100 KB joined)", () => appendRepeated("x-custom", chunk, 1000));
bench("new Headers([60 pairs of one name]) (6 KB joined)", () => new Headers(pairs));

// One join to a value that is long already: what a proxy does to a Cookie header.
bench("new Headers(headers) + append to a 6 KB cookie", () => {
  const headers = new Headers(withLongCookie);
  headers.append("cookie", "a=b");
  return headers;
});
bench("new Headers([[cookie, 6 KB], [cookie, short]])", () => {
  return new Headers([
    ["cookie", longCookie],
    ["cookie", "a=b"],
  ]);
});

await run();
