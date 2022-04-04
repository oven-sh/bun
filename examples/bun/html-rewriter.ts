// Start a fast HTTP server from a function
Bun.serve({
  async fetch(req) {
    if (!(req.url.startsWith("/https://") || req.url.startsWith("/http://"))) {
      return new Response(
        "Enter a path that starts with https:// or http://\n",
        {
          status: 404,
        }
      );
    }

    const url = new URL(req.url.substring(1));
    const response = await fetch(url.toString(), req.clone());

    if (!response.headers.get("Content-Type").includes("html")) {
      return response;
    }

    return new HTMLRewriter()
      .on("a[href]", {
        element(element: Element) {
          element.setAttribute(
            "href",
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          );
        },
      })
      .transform(response);
  },

  // this is called when fetch() throws or rejects
  error(err: Error) {
    return new Response("uh oh! :(\n" + String(err.toString()), {
      status: 500,
      headers: { "Content-Type": "text/plain" },
    });
  },

  // this boolean enables the bun's default error handler
  // sometime after the initial release, it will auto reload as well
  development: process.env.NODE_ENV !== "production",
  // note: this isn't node, but for compatibility bun supports process.env + more stuff in process

  // SSL is enabled if these two are set
  // certFile: './cert.pem',
  // keyFile: './key.pem',

  port: 8080, // number or string
  hostname: "localhost", // defaults to 0.0.0.0
});
