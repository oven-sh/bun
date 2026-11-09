// bun scripts/css-order-check/probe.ts : ad hoc checks of CSS semantics in Chrome. Each case is one style sheet; prints the color of .t.
import { Chrome } from "./cdp.ts";
const cases: Record<string, { css: string; csp?: string; ext?: Record<string, string> }> = {
  // 1. An empty data: import declares its layer at its place between two imports.
  data_import_declares_layer: {
    css: `@import "EXT/one.css" layer(v);@import "data:text/css," layer(w);@import "EXT/two.css" layer(x);@layer x{.t{color:red}}@layer w{.t{color:red}}@layer v{.t{color:red}}@layer x{.t{color:green}}`,
    ext: { "one.css": "", "two.css": "" },
  },
  data_import_w_before_v: {
    css: `@import "data:text/css," layer(w) screen;@import "EXT/one.css" layer(v);@layer v{.t{color:green}}@layer w{.t{color:red}}`,
    ext: { "one.css": "" },
  },
  // 2. A failed import (404) still declares its layer.
  failed_import_declares_layer: {
    css: `@import "EXT/missing.css" layer(w);@import "EXT/one.css" layer(v);@layer v{.t{color:green}}@layer w{.t{color:red}}`,
    ext: { "one.css": "" },
  },
  // 3. A layer statement between two imports makes the later import invalid.
  statement_between_imports: {
    css: `@import "EXT/one.css";@layer a;@import "EXT/two.css";.t{color:green}`,
    ext: { "one.css": "", "two.css": ".t{color:red !important}" },
  },
  // 3b. A layer statement ahead of the imports is fine.
  statement_before_imports: {
    css: `@layer a;@import "EXT/two.css";.t{color:red}`,
    ext: { "two.css": ".t{color:green !important}" },
  },
  // 4. A data: import blocked by CSP still declares its layer.
  csp_blocked_data_import_declares_layer: {
    css: `@import "data:text/css," layer(w);@import "EXT/one.css" layer(v);@layer v{.t{color:green}}@layer w{.t{color:red}}`,
    csp: "style-src 'self'",
    ext: { "one.css": "" },
  },
  // 4b. Names inside a blocked data: style sheet are not declared.
  csp_blocked_data_import_body_lost: {
    css: `@import "data:text/css,@layer w;";@import "EXT/one.css" layer(v);@layer v{.t{color:red}}@layer w{.t{color:green}}`,
    csp: "style-src 'self'",
    ext: { "one.css": "" },
  },
  data_import_body_declares: {
    css: `@import "data:text/css,@layer w;";@import "EXT/one.css" layer(v);@layer v{.t{color:green}}@layer w{.t{color:red}}`,
    ext: { "one.css": "" },
  },
  // 5. Nested data: import with conditions.
  nested_data_import: {
    css: `@import "data:text/css,@import \\"data:text/css,\\" layer(inner);" layer(wrap) screen;@import "EXT/one.css" layer(wrap);@layer wrap{@layer other{.t{color:green}}@layer inner{.t{color:red}}}`,
    ext: { "one.css": "" },
  },
  // 6. layer(a.b) on an import declares a and a.b.
  dotted_layer_import: {
    css: `@import "data:text/css," layer(wrap.inner);@layer wrap{@layer other{.t{color:green}}@layer inner{.t{color:red}}}`,
  },
  // 7. An import with layer(x) and a false supports() does not declare x.
  false_supports_import_does_not_declare: {
    css: `@import "data:text/css," layer(w) supports(bogus-prop: 1px);@layer v{.t{color:red}}@layer w{.t{color:green}}`,
  },
  // 8. A generated name stands for an anonymous layer: the import and the block share it.
  named_stand_in_for_anonymous: {
    css: `@import "EXT/g.css" layer(gen);@layer gen{@layer w{.t{color:red}}}`,
    ext: { "g.css": ".t{color:green}" },
  },
};
const externals = new Map<string, string>();
const pages = new Map<string, { css: string; csp?: string }>();
const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  fetch(req) {
    const url = new URL(req.url);
    if (externals.has(url.pathname)) return new Response(externals.get(url.pathname)!, { headers: { "content-type": "text/css" } });
    const m = /^\/(\w+)\.(html|css)$/.exec(url.pathname);
    const page = m && pages.get(m[1]);
    if (!page) return new Response("nf", { status: 404 });
    if (m![2] === "css") return new Response(page.css, { headers: { "content-type": "text/css" } });
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (page.csp) headers["content-security-policy"] = page.csp;
    return new Response(`<!doctype html><link rel="stylesheet" href="/${m![1]}.css"><div class="t">t</div>`, { headers });
  },
});
const origin = `http://127.0.0.1:${server.port}`;
const chrome = await Chrome.launch();
const only = process.argv[2];
for (const [name, c] of Object.entries(cases)) {
  if (only && !name.includes(only)) continue;
  for (const [file, text] of Object.entries(c.ext ?? {})) externals.set(`/ext/${name}/${file}`, text);
  pages.set(name, { css: c.css.replaceAll("EXT/", `${origin}/ext/${name}/`), csp: c.csp });
  const color = await chrome.evaluate(`${origin}/${name}.html`, "screen", `getComputedStyle(document.querySelector(".t")).color`);
  const names: Record<string, string> = { "rgb(255, 0, 0)": "RED", "rgb(0, 128, 0)": "green", "rgb(0, 0, 0)": "black" };
  console.log(`${name}: ${names[color] ?? color}`);
}
await chrome.close();
server.stop(true);
