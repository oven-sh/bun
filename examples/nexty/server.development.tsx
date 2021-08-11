import ReactDOMServer from "react-dom/server.browser";

addEventListener("fetch", async (event: FetchEvent) => {
  var route = Wundle.match(event);

  console.log("Main:", Wundle.main);
  console.log("cwd:", Wundle.cwd);
  console.log("Origin:", Wundle.origin);

  const { default: PageComponent } = await import(route.filePath);
  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const stylesheets = Wundle.getImportedStyles() as string[];

  const response = new Response(`
  <!DOCTYPE html>
<html>
  <head>
  ${stylesheets
    .map((style) => `<link rel="stylesheet" href="${style}">`)
    .join("\n")}

    <link
      rel="stylesheet"
      crossorigin="anonymous"
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;700&family=Space+Mono:wght@400;700"
    />
  </head>
  <body>

    <div id="reactroot">${ReactDOMServer.renderToString(
      <PageComponent />
    )}</div>

    <script src="${route.scriptSrc}" async type="module"></script>
  </body>
</html>
  `);

  event.respondWith(response);
});

// typescript isolated modules
export {};

declare var Wundle: any;
