import { resolve } from "path";
import { parse } from "querystring";

export default {
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/favicon.ico") return new Response("nooo dont open favicon in editor", { status: 404 });

    let pathname = req.url.substring(1);
    const q = pathname.indexOf("?");
    let { editor } = parse(pathname.substring(q + 1)) || {};

    if (q > 0) {
      pathname = pathname.substring(0, q);
    }

    try {
      Bun.openInEditor(resolve(pathname), {
        editor,
      });
    } catch (error) {
      console.error('Failed to open in editor:', error);
      return new Response('Error opening in editor', { status: 500 });
    }

    return new Response(`Opened ${req.url} in ${editor || 'default editor'}`);
  },
};
