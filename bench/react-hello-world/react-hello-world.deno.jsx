import * as React from "https://esm.run/react";
import { renderToReadableStream } from "https://esm.run/react-dom/server";

const App = () => (
  <html>
    <body>
      <h1>Hello World</h1>
      <p>This is an example.</p>
    </body>
  </html>
);

const headers = {
  headers: {
    "Content-Type": "text/html",
    "Cache-Control": "no-transform", // disables response body auto compression, see https://deno.land/manual/runtime/http_server_apis#automatic-body-compression
  },
};

Deno.serve(
  async req => {
    return new Response(await renderToReadableStream(<App />), headers);
  },
  { port: 8080 },
);
