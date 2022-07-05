import { file, serve } from "bun";
import "shiki";
import { renderToReadableStream } from "../../test/bun.js/reactdom-bun";

import liveReload from "bun-livereload";
import { join } from "path";

const { default: Page } = await import("./page.tsx");
const build = await new Response(
  await renderToReadableStream(<Page inlineCSS />)
).text();

await Bun.write(import.meta.dir + "/public/index.html", build);
await Bun.write(
  import.meta.dir + "/public/index.css",
  Bun.file(import.meta.dir + "/index.css")
);
