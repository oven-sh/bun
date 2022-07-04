import { renderToReadableStream } from "https://esm.run/react-dom/server";
import { serve } from "https://deno.land/std@0.146.0/http/server.ts";
import * as React from "https://esm.run/react";
const headers = {
  headers: {
    "Content-Type": "text/html",
  },
};

await serve(
  async (req) => {
    return new Response(
      await renderToReadableStream(<div>Hello World</div>),
      headers
    );
  },
  { port: 8080 }
);
