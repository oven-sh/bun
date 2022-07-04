// import { renderToReadableStream } from "react-dom/server.browser";
var { renderToReadableStream } = import.meta.require(
  "../test/bun.js/reactdom-bun.js"
);

const headers = {
  headers: {
    "Content-Type": "text/html",
  },
};

export default {
  async fetch(req) {
    return new Response(
      await renderToReadableStream(<div>Hello World</div>),
      headers
    );
  },
};
