// HTML → Markdown: Bun.markdown.fromHTML vs turndown (+ turndown-plugin-gfm).
//
//   bun bench/snippets/html-to-markdown.mjs            # synthetic pages
//   bun bench/snippets/html-to-markdown.mjs page.html  # your own saved pages
//
// turndown is what most JS apps use for this today; it builds a DOM with a
// pure-JS HTML parser (domino) and walks it with regex-heavy rules, so large
// pages cost hundreds of milliseconds of main-thread time and a lot of
// transient garbage. The synthetic input below is shaped like a docs/article
// page (nav, prose with inline markup, code blocks, tables, lists) and is
// repeated to reach the sizes real pages have.
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { bench, group, run } from "../runner.mjs";

function turndown(html) {
  const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced", bulletListMarker: "-", hr: "---" });
  td.use(gfm);
  td.remove(["script", "style"]);
  return td.turndown(html);
}

const section = i => `
<section id="s${i}">
  <h2 class="heading"><a href="#s${i}">Section ${i}: configuring the <code>thing</code></a></h2>
  <p>
    Lorem ipsum <strong>dolor sit amet</strong>, consectetur <em>adipiscing</em> elit. Use
    <a href="/docs/api/thing?id=${i}" title="API reference">the <code>thing()</code> API</a> to
    frobnicate the widget &mdash; it&rsquo;s <del>slow</del> fast now. See issue
    <a href="https://example.com/issues/${1000 + i}">#${1000 + i}</a> for details, and note that
    2 * 3 = 6 and snake_case_names are left alone.
  </p>
  <div class="highlight highlight-source-ts"><pre><code class="language-ts">import { thing } from "pkg";

export async function run${i}(input: string): Promise&lt;number&gt; {
  const result = await thing(input, { retries: ${i % 5}, verbose: true });
  if (!result.ok) throw new Error(\`failed: \${result.error}\`);
  return result.value * 2;
}
</code></pre></div>
  <table class="params">
    <thead><tr><th>Option</th><th align="center">Type</th><th align="right">Default</th><th>Description</th></tr></thead>
    <tbody>
      <tr><td><code>retries</code></td><td><code>number</code></td><td>3</td><td>How many times to retry before giving up.</td></tr>
      <tr><td><code>verbose</code></td><td><code>boolean</code></td><td><code>false</code></td><td>Log each attempt to <code>stderr</code>.</td></tr>
      <tr><td><code>signal</code></td><td><code>AbortSignal</code></td><td>&mdash;</td><td>Cancels the <em>in-flight</em> attempt | and any pending retries.</td></tr>
    </tbody>
  </table>
  <ul>
    <li>First point with <b>bold</b> and a <a href="/x/${i}">link</a></li>
    <li>Second point
      <ol start="3"><li>nested three</li><li>nested four<ul><li>deeper</li></ul></li></ol>
    </li>
    <li><input type="checkbox" checked> done item</li>
    <li><p>Loose item with a paragraph.</p><blockquote><p>And a quote<br>with a break.</p></blockquote></li>
  </ul>
  <p><img src="/img/diagram-${i}.png" alt="Diagram ${i}" width="600" height="400"> <span class="caption">Figure ${i}.</span></p>
  <hr>
</section>`;

function page(sections) {
  let nav = "";
  for (let i = 0; i < sections; i++) nav += `<li><a href="#s${i}">Section ${i}</a></li>`;
  let body = "";
  for (let i = 0; i < sections; i++) body += section(i);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Bench page</title>
<style>body{font-family:sans-serif}.heading{color:#333}</style>
<script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)}</script></head>
<body><header><nav><ul>${nav}</ul></nav></header><main><article><h1>Benchmark <em>page</em></h1>${body}</article></main>
<footer><p>&copy; 2025 Example &middot; <a href="/privacy">Privacy</a></p></footer>
<script type="application/json">${JSON.stringify({ props: { sections } })}</script></body></html>`;
}

const inputs = [];
const files = process.argv.slice(2);
if (files.length) {
  for (const f of files) inputs.push([basename(f), readFileSync(f, "utf8")]);
} else {
  for (const n of [2, 40, 400]) {
    const html = page(n);
    inputs.push([`${(html.length / 1024).toFixed(0)} KB page`, html]);
  }
}

const hasBun = typeof Bun !== "undefined" && Bun.markdown && typeof Bun.markdown.fromHTML === "function";

for (const [name, html] of inputs) {
  group(name, () => {
    if (hasBun) {
      bench("Bun.markdown.fromHTML", () => Bun.markdown.fromHTML(html));
    }
    bench("turndown + gfm", () => turndown(html));
  });
}

await run();
