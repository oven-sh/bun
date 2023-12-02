import { resolve } from "path";
import { parse } from "querystring";

export default {
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/favicon.ico") return new Response("nooo dont open favicon in editor", { status: 404 });

    var pathname = req.url.substring(1);
    const q = pathname.indexOf("?");
    var { editor } = parse(pathname.substring(q + 1)) || {};

    if (q > 0) {
      pathname = pathname.substring(0, q);
    }

    Bun.openInEditor(resolve(pathname), {
      editor,
    });

    return new Response(`Opened ${req.url}`);
  },
};
