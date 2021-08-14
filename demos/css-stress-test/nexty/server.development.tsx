import { render } from "./renderDocument";

let buildId = 0;

var DocumentNamespacePromise;

DocumentNamespacePromise = import(Wundle.routesDir + "_document");
var DocumentLoaded = false;
var DocumentNamespace;

addEventListener("fetch", async (event: FetchEvent) => {
  if (!DocumentLoaded) {
    DocumentLoaded = true;
    try {
      DocumentNamespace = await DocumentNamespacePromise;
    } catch (exception) {
      DocumentNamespace = null;
    }
  }

  var appRoute;

  try {
    appRoute = await import(Wundle.routesDir + "_app");
  } catch (exception) {
    appRoute = null;
  }
  const appStylesheets = (Wundle.getImportedStyles() as string[]).slice();
  var route = Wundle.match(event);

  // This imports the currently matched route.
  const PageNamespace = await import(route.filePath);

  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const pageStylesheets = (Wundle.getImportedStyles() as string[]).slice();

  event.respondWith(
    await render({
      route,
      PageNamespace,
      appStylesheets,
      pageStylesheets,
      DocumentNamespace,
      AppNamespace: appRoute,
      buildId,
      routePaths: Wundle.getRouteFiles(),
    })
  );
  buildId++;
});

// typescript isolated modules
export {};

declare var Wundle: any;

function getNextData(request: Request, route) {
  return {
    NEXT_DATA: {
      query: route.query,
      props: {},
      page: route.path,
      buildId: buildId.toString(16),
    },
  };
}
