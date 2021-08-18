import React from "react";
class URL {
  constructor(base, source) {
    this.pathname = source;
    this.href = base + source;
  }
}
var onlyChildPolyfill = React.Children.only;
React.Children.only = function (children) {
  if (children && typeof children === "object" && children.length == 1) {
    return onlyChildPolyfill(children[0]);
  }

  return onlyChildPolyfill(children);
};
globalThis.URL = URL;
globalThis.global = globalThis;
import { render } from "./renderDocument";

let buildId = 0;

var DocumentNamespacePromise;

DocumentNamespacePromise = import(Bun.routesDir + "_document");
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
    appRoute = await import(Bun.routesDir + "_app");
  } catch (exception) {
    appRoute = null;
  }
  const appStylesheets = (Bun.getImportedStyles() as string[]).slice();
  var route = Bun.match(event);

  // This imports the currently matched route.
  const PageNamespace = await import(route.filePath);

  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const pageStylesheets = (Bun.getImportedStyles() as string[]).slice();

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
    })
  );
  buildId++;
});

// typescript isolated modules
export {};

declare var Bun: any;

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
