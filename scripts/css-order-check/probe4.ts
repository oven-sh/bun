import { Chrome } from "./cdp.ts";
const requests: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/requests") return Response.json(requests);
    requests.push(url.pathname);
    const html = (href: string) => `<!doctype html><link rel="stylesheet" href="${href}"><div class="t">t</div>`;
    switch (url.pathname) {
      case "/p.html":
        return new Response(html("/assets/s.css"), { headers: { "content-type": "text/html" } });
      case "/assets/s.css":
        return new Response(`@import "data:text/css,.t{background-image:url(./img.png)}";`, { headers: { "content-type": "text/css" } });
      case "/blocked.html":
        return new Response(html("/blocked.css"), { headers: { "content-type": "text/html", "content-security-policy": "style-src 'self'" } });
      case "/allowed.html":
        return new Response(html("/blocked.css"), { headers: { "content-type": "text/html" } });
      case "/blocked.css":
        return new Response(`@import "data:text/css,.t{color:green}";.u{color:blue}`, { headers: { "content-type": "text/css" } });
    }
    return new Response("nf", { status: 404 });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const chrome = await Chrome.launch();
const color = `getComputedStyle(document.querySelector(".t")).color`;
await chrome.evaluate(`${origin}/p.html`, "screen", color);
console.log("relative url() in a data: sheet imported by /assets/s.css on /p.html requests:", requests.filter(r => r.includes("img")).join(", "));
console.log("rule in a data: sheet, no CSP:", await chrome.evaluate(`${origin}/allowed.html`, "screen", color));
console.log("rule in a data: sheet, style-src 'self':", await chrome.evaluate(`${origin}/blocked.html`, "screen", color));
await chrome.close();
server.stop(true);
