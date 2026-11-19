import { marked } from "marked";
import { readFileSync } from "node:fs";
import { bench, run, summary } from "../runner.mjs";

const document = readFileSync(new URL("../../docs/runtime/markdown.mdx", import.meta.url), "utf8").slice(0, 8000);

for (const size of [4, 64, 4096]) {
  const chunks = [];
  for (let i = 0; i < document.length; i += size) chunks.push(document.slice(i, i + size));
  const label = `${chunks.length} chunks of ${size} chars`;

  summary(() => {
    if (typeof Bun !== "undefined" && Bun.markdown?.htmlStream) {
      bench(`${label} - htmlStream write()`, () => {
        const stream = Bun.markdown.htmlStream();
        for (const chunk of chunks) stream.write(chunk);
        return stream.end();
      });

      bench(`${label} - htmlStream write() + preview()`, () => {
        const stream = Bun.markdown.htmlStream();
        for (const chunk of chunks) {
          stream.write(chunk);
          stream.preview();
        }
        return stream.end();
      });

      bench(`${label} - tokensStream write() + preview()`, () => {
        const stream = Bun.markdown.tokensStream();
        for (const chunk of chunks) {
          stream.write(chunk);
          stream.preview();
        }
        return stream.end();
      });

      bench(`${label} - Bun.markdown.html of the text so far`, () => {
        let text = "";
        for (const chunk of chunks) Bun.markdown.html((text += chunk));
      });
    }

    bench(`${label} - marked of the text so far`, () => {
      let text = "";
      for (const chunk of chunks) marked((text += chunk));
    });
  });
}

await run();
