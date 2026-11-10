// Which wrappers make a layer declaration conditional? "declared" = the layer joins the order although the wrapper does not apply.
import { Chrome } from "./cdp.ts";
const tail = `@layer a{.t{color:red}}@layer b{.t{color:green}}`;
const cases: Record<string, string> = {
  "media false": `@media (min-width:99999px){@layer b{.x{color:blue}}}` + tail,
  "media false, statement": `@media (min-width:99999px){@layer b;}` + tail,
  "media all": `@media all{@layer b{.x{color:blue}}}` + tail,
  "media not all": `@media not all{@layer b{.x{color:blue}}}` + tail,
  "supports false": `@supports (bogus-prop:1px){@layer b{.x{color:blue}}}` + tail,
  "supports true": `@supports (color:red){@layer b{.x{color:blue}}}` + tail,
  "moz-document": `@-moz-document url-prefix(){@layer b{.x{color:blue}}}` + tail,
  "container false": `@container (min-width:99999px){@layer b{.x{color:blue}}}` + tail,
  "scope no match": `@scope (.nomatch){@layer b{.x{color:blue}}}` + tail,
  "starting-style": `@starting-style{@layer b{.x{color:blue}}}` + tail,
  "style rule no match": `.nomatch{@layer b{color:blue}}` + tail,
  "style rule > media false": `.nomatch{@media (min-width:99999px){@layer b{color:blue}}}` + tail,
  "layer > media false": `@layer o{@media (min-width:99999px){@layer b{.x{color:blue}}}}@layer o{@layer a{.t{color:red}}@layer b{.t{color:green}}}`,
  "media false > media true": `@media (min-width:99999px){@media (min-width:1px){@layer b{.x{color:blue}}}}` + tail,
  "container false > layer statement": `@container (min-width:99999px){@layer b;}` + tail,
};
const pages = new Map<string, string>();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const id = new URL(req.url).pathname.slice(1);
    const css = pages.get(id);
    if (css === undefined) return new Response("nf", { status: 404 });
    return new Response(`<!doctype html><style>${css}</style><div class="t">t</div>`, { headers: { "content-type": "text/html" } });
  },
});
const chrome = await Chrome.launch();
let i = 0;
for (const [name, css] of Object.entries(cases)) {
  const id = "p" + i++;
  pages.set(id, css);
  const color = await chrome.evaluate(`http://127.0.0.1:${server.port}/${id}`, "screen", `getComputedStyle(document.querySelector(".t")).color`);
  console.log(`${name.padEnd(36)} ${color === "rgb(255, 0, 0)" ? "declared (the wrapper is no condition)" : color === "rgb(0, 128, 0)" ? "not declared (a condition)" : color}`);
}
await chrome.close();
server.stop(true);
