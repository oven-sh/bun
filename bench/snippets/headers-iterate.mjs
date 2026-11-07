// Walks a Headers object the ways an adapter that copies a Response's headers somewhere else does.
import { bench, run } from "../runner.mjs";

const few = new Headers({
  "Content-Type": "application/json",
  "Content-Length": "1234",
  "Cache-Control": "no-cache",
});

const many = new Headers({
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
  "Content-Length": "1234",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=15552000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Download-Options": "noopen",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
});

const custom = new Headers();
for (let i = 0; i < 14; i++) custom.set(`X-Custom-Header-${String.fromCharCode(110 - i)}`, `value ${i}`);

const cookies = new Headers(few);
cookies.append("Set-Cookie", "a=1; Path=/");
cookies.append("Set-Cookie", "b=2; Path=/");

for (const [name, headers] of [
  ["3 known names", few],
  ["14 names, 11 known", many],
  ["14 custom names", custom],
  ["3 known names, 2 cookies", cookies],
]) {
  bench(`for (const [k, v] of headers), ${name}`, () => {
    const result = {};
    for (const [k, v] of headers) result[k] = v;
    return result;
  });
}

bench("headers.forEach, 14 names, 11 known", () => {
  const result = {};
  many.forEach((v, k) => {
    result[k] = v;
  });
  return result;
});

bench("[...headers.keys()], 14 names, 11 known", () => [...many.keys()]);
bench("[...headers.values()], 14 names, 11 known", () => [...many.values()]);
bench("Object.fromEntries(headers), 14 names, 11 known", () => Object.fromEntries(many));

await run();
