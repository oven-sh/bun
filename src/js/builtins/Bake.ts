//! JS code for bake

// `Bake.ServerEntryPoint` of src/runtime/bake/bake.d.ts, as far as this file uses it.
type RouteParams = Record<string, string | string[]>;
interface RouteMetadata {
  pageModule: unknown;
  layouts: unknown[];
  params: RouteParams | null;
  modules: string[];
  modulepreload: string[];
  styles: string[];
}
interface PrerenderResult {
  files?: Record<string, Blob | NodeJS.TypedArray | ArrayBufferLike | string | Bun.BlobPart[]>;
}
type GetParamIterator = AsyncIterable<RouteParams> | Iterable<RouteParams> | { pages: RouteParams[] };
type FrameworkPrerender =
  ((routeMetadata: RouteMetadata) => PrerenderResult | null | Promise<PrerenderResult | null>) | undefined;
interface ParamsMetadata {
  pageModule: unknown;
  layouts: unknown[];
}
type FrameworkGetParams =
  ((paramsMetadata: ParamsMetadata) => GetParamIterator | Promise<GetParamIterator>) | undefined;
type TypeAndFlags = number;
type FileIndex = number;

/**
 * This layer is implemented in JavaScript to reduce Native <-> JS context switches,
 * as well as use the async primitives provided by the language.
 */
export async function renderRoutesForProdStatic(
  outBase: string,
  allServerFiles: string[],
  // Indexed by router type index
  renderStatic: FrameworkPrerender[],
  getParams: FrameworkGetParams[],
  clientEntryUrl: string[],
  // Indexed by route index
  patterns: string[],
  files: FileIndex[][],
  typeAndFlags: TypeAndFlags[],
  sourceRouteFiles: string[],
  paramInformation: Array<null | string[]>,
  styles: string[][],
): Promise<void[]> {
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
  const { join: pathJoin, relative: pathRelative } = require("node:path");

  let loadedModules = new Array(allServerFiles.length);

  // The page of each output file, by the path handed to `Bun.write`. A page is a route index and its params.
  const outputFiles = new Map<string, number>();
  const pageRoutes: number[] = [];
  const pageParams: (RouteParams | null)[] = [];

  async function doGenerateRoute(
    type: number,
    noClient: boolean,
    i: number,
    layouts: unknown[],
    pageModule: unknown,
    params: RouteParams | null,
  ) {
    // Call the framework's rendering function
    const callback = renderStatic[type];
    $assert(callback != null && $isCallable(callback));
    let client = clientEntryUrl[type];
    const results = await callback({
      modules: client && !noClient ? [client] : [],
      modulepreload: [],
      styles: styles[i],
      layouts,
      pageModule,
      params,
    } satisfies RouteMetadata);
    if (results == null) {
      throw new Error(`Route ${JSON.stringify(sourceRouteFiles[i])} cannot be pre-rendered to a static page.`);
    }
    if (typeof results !== "object") {
      throw new Error(
        `Rendering route ${JSON.stringify(sourceRouteFiles[i])} did not return an object, got ${Bun.inspect(results)}. This is a bug in the framework.`,
      );
    }
    const { files } = results;
    if (files == null) {
      throw new Error(`Route ${JSON.stringify(sourceRouteFiles[i])} cannot be pre-rendered to a static page.`);
    }

    const entries = Object.entries(files);
    if (entries.length === 0) return;

    let routePath = patterns[i];
    if (params != null) {
      $assert(routePath.includes(`:`));
      routePath = routePath.replace(/:(\w+)/g, (_, p1) =>
        typeof params[p1] === "string" ? params[p1] : params[p1].join("/"),
      );
    }
    const page = pageRoutes.length;
    $arrayPush(pageRoutes, i);
    $arrayPush(pageParams, params);

    // Every file of the page is claimed before the first write, so a page that clashes writes none of its files.
    let kept = 0;
    for (let j = 0; j < entries.length; j++) {
      const entry = entries[j];
      const file = pathJoin(outBase, routePath + entry[0]);
      const owner = outputFiles.$get(file);
      if (owner === undefined) {
        outputFiles.$set(file, page);
        entry[0] = file;
        entries[kept++] = entry;
        continue;
      }
      const ownerRoute = pageRoutes[owner];
      // A route that yields the same params again renders the same page again. The file is not written again.
      if (ownerRoute === i && owner !== page && Bun.deepEquals(pageParams[owner], params)) continue;

      const output = JSON.stringify(pathRelative(outBase, file));
      if (ownerRoute === i) {
        throw new Error(
          `Route ${JSON.stringify(sourceRouteFiles[i])} generates the output file ${output} more than once.`,
        );
      }
      // The two pages can arrive in either order, and route indexes follow the order of the directory scan.
      let a = sourceRouteFiles[ownerRoute];
      let b = sourceRouteFiles[i];
      if (a > b) {
        a = b;
        b = sourceRouteFiles[ownerRoute];
      }
      throw new Error(`Routes ${JSON.stringify(a)} and ${JSON.stringify(b)} both generate the output file ${output}.`);
    }
    entries.length = kept;

    await Promise.all(entries.map(entry => Bun.write(entry[0], entry[1])));
  }

  function callRouteGenerator(
    type: number,
    noClient: boolean,
    i: number,
    layouts: unknown[],
    pageModule: unknown,
    params: RouteParams,
  ) {
    for (const param of paramInformation[i]!) {
      if (params[param] === undefined) {
        throw new Error(`Missing param ${param} for route ${JSON.stringify(sourceRouteFiles[i])}`);
      }
    }
    return doGenerateRoute(type, noClient, i, layouts, pageModule, params);
  }

  let modulesForFiles: unknown[][] = [];
  for (const fileList of files) {
    $assert(fileList.length > 0);
    if (fileList.length > 1) {
      let anyPromise = false;
      let loaded = fileList.map(
        x => loadedModules[x] ?? ((anyPromise = true), import(allServerFiles[x]).then(x => (loadedModules[x] = x))),
      );
      modulesForFiles.push(anyPromise ? await Promise.all(loaded) : loaded);
    } else {
      const id = fileList[0];
      modulesForFiles.push([loadedModules[id] ?? (loadedModules[id] = await import(allServerFiles[id]))]);
    }
  }

  return Promise.all(
    modulesForFiles.map(async (modules, i) => {
      const typeAndFlag = typeAndFlags[i];
      const type = typeAndFlag & 0xff;
      const noClient = (typeAndFlag & 0b100000000) !== 0;

      let [pageModule, ...layouts] = modules;

      if (paramInformation[i] != null) {
        const getParam = getParams[type];
        $assert(getParam != null && $isCallable(getParam));
        const paramGetter: GetParamIterator = await getParam({
          pageModule,
          layouts,
        });
        if (paramGetter[Symbol.asyncIterator] != undefined) {
          for await (const params of paramGetter as AsyncIterable<RouteParams>) {
            await callRouteGenerator(type, noClient, i, layouts, pageModule, params);
          }
        } else if (paramGetter[Symbol.iterator] != undefined) {
          for (const params of paramGetter as Iterable<RouteParams>) {
            await callRouteGenerator(type, noClient, i, layouts, pageModule, params);
          }
        } else {
          await Promise.all(
            (paramGetter as { pages: RouteParams[] }).pages.map(params =>
              callRouteGenerator(type, noClient, i, layouts, pageModule, params),
            ),
          );
        }
      } else {
        await doGenerateRoute(type, noClient, i, layouts, pageModule, null);
      }
    }),
  );
}
