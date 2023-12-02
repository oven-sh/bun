import { file, serve } from "bun";
import { existsSync, statSync } from "fs";

serve({
  fetch(req: Request) {
    let pathname = new URL(req.url).pathname.substring(1);
    if (pathname == "") {
      pathname = import.meta.url.replace("file://", "");
    }

    if (!existsSync(pathname)) {
      return new Response(null, { status: 404 });
    }

    const stats = statSync(pathname);

    // https://github.com/gornostay25/svelte-adapter-bun/blob/master/src/sirv.js
    const headers = new Headers({
      "Content-Length": "" + stats.size,
      "Last-Modified": stats.mtime.toUTCString(),
      ETag: `W/"${stats.size}-${stats.mtime.getTime()}"`,
    });

    if (req.headers.get("if-none-match") === headers.get("ETag")) {
      return new Response(null, { status: 304 });
    }

    const opts = { code: 200, start: 0, end: Infinity, range: false };

    if (req.headers.has("range")) {
      opts.code = 206;
      let [x, y] = req.headers.get("range")!.replace("bytes=", "").split("-");
      let end = (opts.end = parseInt(y, 10) || stats.size - 1);
      let start = (opts.start = parseInt(x, 10) || 0);

      if (start >= stats.size || end >= stats.size) {
        headers.set("Content-Range", `bytes */${stats.size}`);
        return new Response(null, {
          headers: headers,
          status: 416,
        });
      }

      headers.set("Content-Range", `bytes ${start}-${end}/${stats.size}`);
      headers.set("Content-Length", "" + (end - start + 1));
      headers.set("Accept-Ranges", "bytes");
      opts.range = true;
    }

    if (opts.range) {
      return new Response(file(pathname).slice(opts.start, opts.end), {
        headers,
        status: opts.code,
      });
    }

    return new Response(file(pathname), { headers, status: opts.code });
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
