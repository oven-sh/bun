import ReactDOMServer from "react-dom/server.browser";

addEventListener(
  "fetch",

  // Anything imported in here will automatically reload in development.
  // The module registry cache is reset at the end of each page load
  async (event: FetchEvent) => {
    var appRoute;

    try {
      appRoute = await import(Wundle.routesDir + "_app");
    } catch (exception) {
      appRoute = null;
    }

    var route = Wundle.match(event);

    // This imports the currently matched route.
    const { default: PageComponent } = await import(route.filePath);

    // This returns all .css files that were imported in the line above.
    // It's recursive, so any file that imports a CSS file will be included.
    const stylesheets = Wundle.getImportedStyles() as string[];

    // Ordinarily, this is just the formatted filepath URL (rewritten to match the public url of the HTTP server)
    // But, when you set `client` in the package.json for the framework, this becomes a path like this:
    // "/pages/index.js" -> "pages/index.entry.js" ("entry" is for entry point)
    const src = route.scriptSrc;

    // From there, the inside of that script like this:
    // ```
    // import * as Framework from 'framework-path';
    // import * as EntryPoint from 'entry-point';
    //
    // Framework.default(EntryPoint);
    // ```
    // That's how the client-side framework loads

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

    <div id="#__next">${ReactDOMServer.renderToString(<PageComponent />)}</div>

    <script src="${src}" async type="module"></script>
  </body>
</html>
  `);

    event.respondWith(response);
  }
);

// typescript isolated modules
export {};

declare var Wundle: any;
