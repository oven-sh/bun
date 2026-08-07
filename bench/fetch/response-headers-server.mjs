// Serves a 2-byte body under one of three response-header profiles, keyed by
// path: /small (2 headers), /nginx (14, API-gateway style), /cookies (long
// Location/Set-Cookie values). Pair with response-headers.mjs; run it in its
// own process (ideally pinned to other cores) so it doesn't share a CPU with
// the client:  PORT=4001 bun bench/fetch/response-headers-server.mjs
const sets = {
  small: { "Content-Type": "text/plain", "X-Id": "1" },
  nginx: {
    "Server": "nginx/1.25.3",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Accept-Encoding",
    "Cache-Control": "private, max-age=0, no-cache, no-store, must-revalidate",
    "ETag": 'W/"bc55-7Zci8Yc4Bq3vJk8pQ0h5nX0m9sE"',
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "SAMEORIGIN",
    "X-Request-Id": "3f1c9a7e-5b2d-4c8e-9f0a-1b2c3d4e5f60",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Expose-Headers": "X-Request-Id, ETag, Link",
    "X-RateLimit-Limit": "5000",
    "X-RateLimit-Remaining": "4987",
    "X-RateLimit-Reset": "1723025489",
  },
  cookies: {
    "Location":
      "https://accounts.example.com/signin/v2/identifier?continue=https%3A%2F%2Fmail.example.com%2Fmail%2F&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin",
    "Set-Cookie":
      "__Host-SESSION=CgQIARAB.eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000",
    "Content-Type": "text/html; charset=UTF-8",
    "Alt-Svc": 'h3=":443"; ma=2592000,h3-29=":443"; ma=2592000',
  },
};
const responses = Object.fromEntries(Object.entries(sets).map(([k, h]) => [k, { headers: new Headers(h) }]));
const server = Bun.serve({
  port: Number(process.env.PORT || 0),
  reusePort: true,
  fetch(req) {
    const kind = req.url.slice(req.url.lastIndexOf("/") + 1) || "nginx";
    return new Response("ok", responses[kind]);
  },
});
console.log(server.port);
