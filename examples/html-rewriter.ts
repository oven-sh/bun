// Start a fast HTTP server from a function

Bun.serve({
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (!(pathname.startsWith("/https://") || pathname.startsWith("/http://"))) {
      return new Response("Enter a path that starts with https:// or http://\n", {
        status: 400,
      });
    }

    const response = await fetch(req.url.substring("http://localhost:3000/".length), req.clone());

    return new HTMLRewriter()
      .on("a[href]", {
        element(element) {
          element.setAttribute("href", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
        },
      })
      .transform(response);
  },

  // this is called when fetch() throws or rejects
  //   error(err: Error) {
  //   },

  // this boolean enables the bun's default error handler
  // sometime after the initial release, it will auto reload as well
  development: process.env.NODE_ENV !== "production",
  // note: this isn't node, but for compatibility bun supports process.env + more stuff in process

  // SSL is enabled if these two are set
  // certFile: './cert.pem',
  // keyFile: './key.pem',

  port: 3000, // number or string
});
