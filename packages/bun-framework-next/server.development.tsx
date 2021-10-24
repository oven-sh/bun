import nextPackage from "next/package.json";
import "./polyfills";
import { render } from "./renderDocument";

const { version } = nextPackage;
if (
  !version.startsWith("11.1") ||
  version === "11.1.0" ||
  version === "11.1.1"
) {
  console.warn(
    "Possibly incompatible Next.js version: ",
    version,
    ". Please upgrade to Next.js 11.1.2 or later.\n"
  );
}

let buildId = 0;

var DocumentLoaded = false;
var DocumentNamespace;

import(Bun.routesDir + "_document").then(
  (doc) => {
    DocumentNamespace = doc;
    DocumentLoaded = true;
  },
  (err) => {
    if (err instanceof ResolveError) {
      DocumentLoaded = true;
    } else {
      console.error(err);
    }
  }
);

addEventListener("fetch", async (event: FetchEvent) => {
  var route = Bun.match(event);

  // This imports the currently matched route.
  const PageNamespace = await import(route.filePath);

  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const pageStylesheets = (Bun.getImportedStyles() as string[]).slice();

  var appRoute;

  try {
    appRoute = await import(Bun.routesDir + "_app");
  } catch (exception) {
    appRoute = null;
  }
  const appStylesheets = (Bun.getImportedStyles() as string[]).slice();
  event.respondWith(
    render({
      route,
      PageNamespace,
      appStylesheets,
      pageStylesheets,
      DocumentNamespace,
      AppNamespace: appRoute,
      buildId,
      routePaths: Bun.getRouteFiles(),
      routeNames: Bun.getRouteNames(),
      request: event.request,
    })
  );
  buildId++;
});

// typescript isolated modules
export {};

declare var Bun: any;
