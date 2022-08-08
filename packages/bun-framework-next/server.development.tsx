import { render } from "./renderDocument";
import packagejson from "next/package.json";

const version = packagejson.version;

if (!version.startsWith("12.2")) {
  console.warn(
    "Possibly incompatible Next.js version: ",
    version,
    ". Please upgrade to Next.js 12.2.0+.\n"
  );
}

let buildId = 0;

let DocumentLoaded = false;
let DocumentNamespace;

import(Bun.routesDir + "_document").then(
  (doc) => {
    DocumentNamespace = doc;
    DocumentLoaded = true;
  },
  (err) => {
    // ResolveError is defined outside of bun-framework-next in ../../src/runtime/errors
    // @ts-expect-error
    if (err instanceof ResolveError) {
      DocumentLoaded = true;
    } else {
      console.error(err);
    }
  }
);

addEventListener("fetch", async (event: FetchEvent) => {
  const route = Bun.match(event);

  // This imports the currently matched route.
  let PageNamespace: any;

  try {
    PageNamespace = await import(route.filePath);
  } catch (exception) {
    console.error("Error loading page:", route.filePath);
    throw exception;
  }

  // This returns all .css files that were imported in the line above.
  // It's recursive, so any file that imports a CSS file will be included.
  const pageStylesheets = (Bun.getImportedStyles() as string[]).slice();

  let appRoute: any;

  try {
    appRoute = await import(Bun.routesDir + "_app");
  } catch (exception) {
    // ResolveError is defined outside of bun-framework-next in ../../src/runtime/errors
    // @ts-expect-error
    if (exception && !(exception instanceof ResolveError)) {
      console.error("Error loading app:", Bun.routesDir + "_app");
      throw exception;
    }
  }

  const appStylesheets = (Bun.getImportedStyles() as string[]).slice();
  let response: Response;
  try {
    response = await render({
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
    });
  } catch (exception) {
    console.error("Error rendering route", route.filePath);
    throw exception;
  }

  event.respondWith(response);

  buildId++;
});

declare let Bun: any;
export {};
