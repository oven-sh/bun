import { file, serve } from "bun";

serve({
  fetch(req: Request) {
    const pathname = new URL(req.url).pathname.substring(1);

    // If the URL is empty, display this file.
    if (pathname === "") {
      return new Response(file(import.meta.url.replace("file://", "")));
    }

    return new Response(file(pathname));
  },

  // this is called when fetch() throws or rejects
  // error(err: Error) {
  // return new Response("uh oh! :(" + String(err.toString()), { status: 500 });
  // },

  // this boolean enables the bun's default error handler
  // sometime after the initial release, it will auto reload as well
  development: process.env.NODE_ENV !== "production",
  // note: this isn't node, but for compatibility bun supports process.env + more stuff in process

  // SSL is enabled if these two are set
  // certFile: './cert.pem',
  // keyFile: './key.pem',

  port: 3000, // number or string
  hostname: "localhost", // defaults to 0.0.0.0
});
