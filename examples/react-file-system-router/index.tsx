// A simple way to connect FileSystemRouter to Bun#serve
// run with `bun run index.tsx`

import { renderToReadableStream } from "react-dom/server";
import { FileSystemRouter } from "bun";

export default {
  port: 3000,
  async fetch(request: Request) {
    const router = new FileSystemRouter({
      dir: process.cwd() + "/pages",
      style: "nextjs",
    });

    const route = router.match(request);

    const { default: Root } = await import(route.filePath!);
    return new Response(await renderToReadableStream(<Root {...route.params} />));
  },
};
