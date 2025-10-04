//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />

/**
 * This layer is implemented in JavaScript to reduce Native <-> JS context switches,
 * as well as use the async primitives provided by the language.
 */
export async function renderRoutesForProdStatic(
  outBase,
  allServerFiles,
  // Indexed by router type index
  renderStatic,
  getParams,
  clientEntryUrl,
  routerTypeRoots,
  routerTypeServerEntrypoints,
  serverRuntime,

  // The following fields represent a structure of arrays indexed by NAVIGABLE
  // route indices: these are the routes which are the leaves in the route graph
  // thing we have
  patterns,
  files,
  typeAndFlags,
  sourceRouteFiles,
  paramInformation,
  styles,
  routeIndices,
) {
  const computeRouteWithParams = $newZigFunction("production.zig", "PerThread.computeRouteWithParams", 3);

  $debug({
    outBase,
    allServerFiles,
    renderStatic,
    clientEntryUrl,
    patterns,
    files,
    typeAndFlags,
    sourceRouteFiles,
    paramInformation,
    styles,
  });
  const { join: pathJoin } = require("node:path");

  // Helper function to make paths relative to _bun folder (removes _bun/ prefix and adds ./)
  function makeRelativeToBun(path: string): string {
    if (path.startsWith("/_bun/")) {
      return "./" + path.slice(6); // Remove "/_bun/" and add ./ prefix
    } else if (path.startsWith("_bun/")) {
      return "./" + path.slice(5); // Remove "_bun/" and add ./ prefix
    }
    return "./" + path;
  }

  // Helper function to process route paths: removes router type prefix and extension, ensures leading slash
  function processRoutePath(sourceRoute: string, routerRoot: string | undefined): string {
    let routePath = sourceRoute;

    // Remove router type prefix if present
    if (routerRoot && routePath.startsWith(routerRoot)) {
      routePath = routePath.slice(routerRoot.length);
      if (routePath.startsWith("/")) {
        routePath = routePath.slice(1);
      }
    }

    // Remove extension
    const lastDot = routePath.lastIndexOf(".");
    if (lastDot > 0) {
      routePath = routePath.slice(0, lastDot);
    }

    // Ensure it starts with /
    if (!routePath.startsWith("/")) {
      routePath = "/" + routePath;
    }

    return routePath;
  }

  let loadedModules = new Array(allServerFiles.length);

  async function doGenerateRoute(
    type: number,
    noClient: boolean,
    navigableRouteIndex: number,
    layouts: any[],
    pageModule: any,
    params,
  ) {
    // Call the framework's rendering function
    const callback = renderStatic[type];
    $assert(callback != null && $isCallable(callback));
    let client = clientEntryUrl[type];
    const results = await callback({
      modules: client && !noClient ? [client] : [],
      modulepreload: [],
      styles: styles[navigableRouteIndex],
      layouts,
      pageModule,
      params,
    });
    if (results == null) {
      throw new Error(
        `Route ${JSON.stringify(sourceRouteFiles[navigableRouteIndex])} cannot be pre-rendered to a static page.`,
      );
    }
    if (typeof results !== "object") {
      throw new Error(
        `Rendering route ${JSON.stringify(sourceRouteFiles[navigableRouteIndex])} did not return an object, got ${Bun.inspect(results)}. This is a bug in the framework.`,
      );
    }
    const { files } = results;
    if (files == null) {
      throw new Error(
        `Route ${JSON.stringify(sourceRouteFiles[navigableRouteIndex])} cannot be pre-rendered to a static page.`,
      );
    }

    let routePath: string = patterns[navigableRouteIndex];
    if (params != null) {
      $assert(patterns[navigableRouteIndex].includes(`:`));
      routePath = computeRouteWithParams(routeIndices[navigableRouteIndex], params, patterns[navigableRouteIndex]);
    }

    await Promise.all(
      Object.entries(files).map(([key, value]) => {
        return Bun.write(pathJoin(outBase, routePath, key), value);
      }),
    );
  }

  function callRouteGenerator(
    type: number,
    noClient: boolean,
    navigableRouteIndex: number,
    layouts: any[],
    pageModule: any,
    params,
  ) {
    for (const param of paramInformation[navigableRouteIndex]!) {
      if (params[param] === undefined) {
        throw new Error(`Missing param ${param} for route ${JSON.stringify(sourceRouteFiles[navigableRouteIndex])}`);
      }
    }
    return doGenerateRoute(type, noClient, navigableRouteIndex, layouts, pageModule, params);
  }

  // Load the modules for all files, we need to do this sequentially due to bugs
  // related to loading many modules at once
  let modulesForFiles = [];
  for (const fileList of files) {
    $assert(fileList.length > 0);
    if (fileList.length > 1) {
      let anyPromise = false;
      let loaded = fileList.map(
        fileIndex =>
          loadedModules[fileIndex] ??
          ((anyPromise = true), import(allServerFiles[fileIndex]).then(x => (loadedModules[x] = x))),
      );
      modulesForFiles.push(anyPromise ? await Promise.all(loaded) : loaded);
    } else {
      const id = fileList[0];
      modulesForFiles.push([loadedModules[id] ?? (loadedModules[id] = await import(allServerFiles[id]))]);
    }
  }

  type SSRManifest = {
    mode: "ssr";
    route: string;
    routeType: number;
    clientEntrypoint?: string;
    modules?: string[];
    styles: string[];
  };

  type SSGManifest = {
    mode: "ssg";
    route: string;
    routeType: number;
    entrypoint: string;
    params?: Record<string, string>;
    styles: string[];
  };

  type ManifestEntry = SSRManifest | SSGManifest;

  type Manifest = {
    version: string;
    routes: ManifestEntry[];
    routerTypes: Array<{ serverEntrypoint: string | null }>;
    assets: Array<string>;
  };

  let entries: ManifestEntry[] = [];

  await Promise.all(
    modulesForFiles.map(async (modules, navigableRouteIndex) => {
      const typeAndFlag = typeAndFlags[navigableRouteIndex];
      const type = typeAndFlag & 0xff;
      const noClient = (typeAndFlag & 0b100000000) !== 0;

      let [pageModule, ...layouts] = modules;

      // Check if page is SSR or SSG and add to manifest
      if (pageModule.mode === "ssr") {
        const routePath = processRoutePath(sourceRouteFiles[navigableRouteIndex], routerTypeRoots[type]);

        // Add SSR entry to manifest (make modules relative to _bun folder)
        const ssrEntry: SSRManifest = {
          mode: "ssr",
          route: routePath,
          routeType: type,
          clientEntrypoint: clientEntryUrl[type] || "",
          modules: allServerFiles
            .filter((_: any, index: number) => files[navigableRouteIndex].includes(index))
            .map((path: string) => {
              // Remove "bake:/" prefix first, then make relative to _bun folder
              const cleanPath = path.startsWith("bake:/") ? path.slice(6) : path;
              return makeRelativeToBun(cleanPath);
            }),
          styles: styles[navigableRouteIndex],
        };
        entries.push(ssrEntry);
        // Skip static generation for SSR pages
        return;
      }

      // For SSG pages, we need to handle params
      if (paramInformation[navigableRouteIndex] != null) {
        const getParam = getParams[type];
        $assert(getParam != null && $isCallable(getParam));
        const paramGetter = await getParam({
          pageModule,
          layouts,
        });

        // For SSG, we need the client-side JavaScript for hydration, not the server module
        const clientEntry = clientEntryUrl[type] || "";
        const routePath = processRoutePath(sourceRouteFiles[navigableRouteIndex], routerTypeRoots[type]);

        // Create an entry for each param combination
        const addSsgEntry = (params: any) => {
          const ssgEntry: SSGManifest = {
            mode: "ssg",
            route: routePath,
            routeType: type,
            entrypoint: clientEntry,
            params: params,
            styles: styles[navigableRouteIndex],
          };
          entries.push(ssgEntry);
        };

        let result;
        if (paramGetter[Symbol.asyncIterator] != undefined) {
          for await (const params of paramGetter) {
            addSsgEntry(params);
            result = callRouteGenerator(type, noClient, navigableRouteIndex, layouts, pageModule, params);
            if ($isPromise(result) && $isPromisePending(result)) {
              await result;
            }
          }
        } else if (paramGetter[Symbol.iterator] != undefined) {
          for (const params of paramGetter) {
            addSsgEntry(params);
            result = callRouteGenerator(type, noClient, navigableRouteIndex, layouts, pageModule, params);
            if ($isPromise(result) && $isPromisePending(result)) {
              await result;
            }
          }
        } else {
          await Promise.all(
            paramGetter.pages.map(params => {
              addSsgEntry(params);
              return callRouteGenerator(type, noClient, navigableRouteIndex, layouts, pageModule, params);
            }),
          );
        }
      } else {
        // No params, single SSG entry
        // For SSG, we need the client-side JavaScript for hydration, not the server module
        const clientEntry = clientEntryUrl[type] || "";
        const routePath = processRoutePath(sourceRouteFiles[navigableRouteIndex], routerTypeRoots[type]);

        const ssgEntry: SSGManifest = {
          mode: "ssg",
          route: routePath,
          routeType: type,
          entrypoint: clientEntry,
          styles: styles[navigableRouteIndex],
        };
        entries.push(ssgEntry);

        await doGenerateRoute(type, noClient, navigableRouteIndex, layouts, pageModule, null);
      }
    }),
  );

  // Build the router_types array (make serverEntrypoint relative to _bun folder)
  const routerTypes: Array<{ serverEntrypoint: string | null }> = [];
  for (let i = 0; i < routerTypeServerEntrypoints.length; i++) {
    const serverEntrypoint = routerTypeServerEntrypoints[i];
    if (serverEntrypoint) {
      // Remove "bake:/" prefix first, then make relative to _bun folder
      const cleanPath = serverEntrypoint.startsWith("bake:/") ? serverEntrypoint.slice(6) : serverEntrypoint;
      routerTypes.push({
        serverEntrypoint: makeRelativeToBun(cleanPath),
      });
    } else {
      // Push null or empty object if no server entrypoint
      routerTypes.push({
        serverEntrypoint: null,
      });
    }
  }

  const manifest: Manifest = {
    version: "0.0.1",
    routes: entries,
    routerTypes: routerTypes,
    assets: [],
  };

  return manifest;
}
