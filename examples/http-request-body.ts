import { serve } from "bun";

serve({
  async fetch(req) {
    // body is a ReadableStream
    const body = req.body;

    const writer = Bun.file(`upload.${Date.now()}.txt`).writer();
    for await (const chunk of body!) {
      writer.write(chunk);
    }
    const wrote = await writer.end();

    // @ts-ignore
    return Response.json({ wrote, type: req.headers.get("Content-Type") });
  },
});
