import ReactDOMServer from "react-dom/server.browser";

addEventListener("fetch", async (event: FetchEvent) => {
  var route = Wundle.match(event);
  const { default: PageComponent } = await import(route.filepath);
  // const router = Wundle.Router.match(event);
  // console.log("Route", router.name);

  // const { Base: Page } = await router.import();

  const response = new Response(`
  <!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="./src/index.css" />
    <link
      rel="stylesheet"
      crossorigin="anonymous"
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&family=Space+Mono:wght@400;700"
    />
  </head>
  <body>
    <link rel="stylesheet" href="./src/index.css" />
    <div id="reactroot">${ReactDOMServer.renderToString(
      <PageComponent />
    )}</div>

    <script src="./src/index.tsx" async type="module"></script>
  </body>
</html>
  `);

  event.respondWith(response);
});

// typescript isolated modules
export {};
