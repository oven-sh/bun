// Facts for the item 1 options, in Chrome.
import { Chrome } from "./cdp.ts";
type Case = { css: string; csp?: string; ext?: Record<string, string>; expr?: string };
const cases: Record<string, Case> = {
  // A blocked data: import: how many CSP reports, and is the layer still declared?
  csp_report_count: {
    css: `@import "data:text/css," layer(w);@import "EXT/one.css" layer(v);@layer v{.t{color:green}}@layer w{.t{color:red}}`,
    csp: "style-src 'self'",
    ext: { "one.css": "" },
    expr: `JSON.stringify({ color: getComputedStyle(document.querySelector(".t")).color, violations: window.__violations })`,
  },
  // Rules carried in a data: sheet: where does a relative url() point?
  relative_url_in_data_sheet: {
    css: `@import "data:text/css,.t{background-image:url(./img.png)}";`,
    expr: `JSON.stringify({ image: getComputedStyle(document.querySelector(".t")).backgroundImage, requested: await (await fetch("/requests")).json() })`,
  },
  // Rules carried in a data: sheet under a strict style-src: they are lost.
  rules_in_blocked_data_sheet: {
    css: `@import "data:text/css,.t{color:red}";@import "EXT/one.css";.u{color:blue}`,
    csp: "style-src 'self'",
    ext: { "one.css": ".t{color:green}" },
  },
  // 1c today: the bundled rules keep their place behind "q". The external sheet has only @font-face.
  bare_layer_today: {
    css: `@import "EXT/fonts.css" layer;@layer q{.t{color:red}}@layer{.t{color:green}}`,
    ext: { "fonts.css": "@font-face{font-family:F;src:local(Arial)}" },
  },
  // 1c with a generated name: the bundled rules move ahead of "q" with the import.
  bare_layer_generated_name: {
    css: `@import "EXT/fonts.css" layer(gen);@layer q{.t{color:red}}@layer gen{.t{color:green}}`,
    ext: { "fonts.css": "@font-face{font-family:F;src:local(Arial)}" },
  },
};
const externals = new Map<string, string>();
const pages = new Map<string, Case>();
const requests: string[] = [];
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/requests") return Response.json(requests);
    requests.push(url.pathname);
    if (externals.has(url.pathname)) return new Response(externals.get(url.pathname)!, { headers: { "content-type": "text/css" } });
    const m = /^\/(\w+)\.(html|css)$/.exec(url.pathname);
    const page = m && pages.get(m[1]);
    if (!page) return new Response("nf", { status: 404 });
    if (m![2] === "css") return new Response(page.css, { headers: { "content-type": "text/css" } });
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (page.csp) headers["content-security-policy"] = page.csp;
    return new Response(
      `<!doctype html><script>window.__violations=0;document.addEventListener("securitypolicyviolation",()=>window.__violations++)</script><link rel="stylesheet" href="/${m![1]}.css"><div class="t">t</div>`,
      { headers },
    );
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const chrome = await Chrome.launch();
for (const [name, c] of Object.entries(cases)) {
  for (const [file, text] of Object.entries(c.ext ?? {})) externals.set(`/ext/${name}/${file}`, text);
  pages.set(name, { ...c, css: c.css.replaceAll("EXT/", `${origin}/ext/${name}/`) });
  requests.length = 0;
  const value = await chrome.evaluate(`${origin}/${name}.html`, "screen", `(async () => ${c.expr ?? `getComputedStyle(document.querySelector(".t")).color`})()`);
  console.log(`${name}: ${value}`);
}
await chrome.close();
server.stop(true);
