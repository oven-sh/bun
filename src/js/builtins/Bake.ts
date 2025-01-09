//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />
import type { Bake } from "bun";

type FrameworkPrerender = Bake.ServerEntryPoint["prerender"];
type FrameworkGetParams = Bake.ServerEntryPoint["getParams"];
type TypeAndFlags = number;
type FileIndex = number;

/**
 * This layer is implemented in JavaScript to reduce Native <-> JS context switches,
 * as well as use the async primitives provided by the language.
 */
export function renderRoutesForProdStatic(
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
): Promise<void> {
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

  let loadedModules = new Array(allServerFiles.length);

  async function doGenerateRoute(
    type: number,
    i: number,
    layouts: any[],
    pageModule: any,
    params: Record<string, string> | null,
  ) {
    // Call the framework's rendering function
    const callback = renderStatic[type];
    $assert(callback != null && $isCallable(callback));
    let client = clientEntryUrl[type];
    const results = await callback({
      modules: client ? [client] : [],
      modulepreload: [],
      styles: styles[i],
      layouts,
      pageModule,
      params,
    } satisfies Bake.RouteMetadata);
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
    await Promise.all(
      Object.entries(files).map(([key, value]) => {
        if (params != null) {
          $assert(patterns[i].includes(`:`));
          // replace the :paramName part of patterns[i] with the value of params[paramName]
          // use a regex in replace with a callback
          const newKey = patterns[i].replace(/:(\w+)/g, (_, p1) => params[p1]);
          return Bun.write(pathJoin(outBase, newKey + key), value);
        }
        return Bun.write(pathJoin(outBase, patterns[i] + key), value);
      }),
    );
  }

  function callRouteGenerator(
    type: number,
    i: number,
    layouts: any[],
    pageModule: any,
    params: Record<string, string>,
  ) {
    for (const param of paramInformation[i]!) {
      if (!params[param]) {
        throw new Error(`Missing param ${param} for route ${JSON.stringify(sourceRouteFiles[i])}`);
      }
    }
    return doGenerateRoute(type, i, layouts, pageModule, params);
  }

  return Promise.all(
    files.map(async (fileList, i) => {
      const typeAndFlag = typeAndFlags[i];
      const type = typeAndFlag & 0xff;

      var pageModule: any, layouts: any[];
      $assert(fileList.length > 0);
      if (fileList.length > 1) {
        let anyPromise = false;
        let loaded = fileList.map(
          x => loadedModules[x] ?? ((anyPromise = true), import(allServerFiles[x]).then(x => (loadedModules[x] = x))),
        );
        [pageModule, ...layouts] = anyPromise ? await Promise.all(loaded) : loaded;
      } else {
        const id = fileList[0];
        pageModule = loadedModules[id] ?? (loadedModules[id] = await import(allServerFiles[id]));
        layouts = [];
      }

      if (paramInformation[i] != null) {
        const getParam = getParams[type];
        $assert(getParam != null && $isCallable(getParam));
        const paramGetter: Bake.GetParamIterator = await getParam({
          pageModule,
          layouts,
        });
        if (paramGetter[Symbol.asyncIterator] != undefined) {
          for await (const params of paramGetter) {
            callRouteGenerator(type, i, layouts, pageModule, params);
          }
        } else if (paramGetter[Symbol.iterator] != undefined) {
          for (const params of paramGetter) {
            callRouteGenerator(type, i, layouts, pageModule, params);
          }
        } else {
          await Promise.all(
            paramGetter.pages.map(params => {
              callRouteGenerator(type, i, layouts, pageModule, params);
            }),
          );
        }
      } else {
        await doGenerateRoute(type, i, layouts, pageModule, null);
      }
    }),
  );
}
