import ReactDOMServer from "react-dom/server.browser";
import { Base } from "./src/index";

addEventListener("fetch", (event: FetchEvent) => {
  const response = new Response(`
  <!DOCTYPE html>
<html>
  <head>
    <link
      rel="stylesheet"
      crossorigin="anonymous"
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&family=Space+Mono:wght@400;700"
    />
  </head>
  <body>
    <link rel="stylesheet" href="./src/index.css" />
    <div id="reactroot">${ReactDOMServer.renderToString(<Base />)}</div>

    <script src="./src/index.tsx" async type="module"></script>
  </body>
</html>
  `);

  event.respondWith(response);
});

// typescript isolated modules
export {};
