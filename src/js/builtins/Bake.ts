//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />
import type { Bake } from "bun";

type FrameworkPrerender = Bake.ServerEntryPoint["prerender"];
type FrameworkGetParams = Bake.ServerEntryPoint["getParams"];
type TypeAndFlags = number;
type FileIndex = number;
type Params = Record<string, string | string[]>;
/** One URL segment of a route: static text, or the name of the param that fills it. */
interface RoutePart {
  kind: "text" | "param" | "catchAll";
  value: string;
}

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
  routeParts: RoutePart[][],
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
    routeParts,
    files,
    typeAndFlags,
    sourceRouteFiles,
    paramInformation,
    styles,
  });
  const { join: pathJoin } = require("node:path");

  let loadedModules = new Array(allServerFiles.length);

  /** The route's output directory relative to `outBase`, with each dynamic segment filled from `params`. */
  function routePath(i: number, params: Params | null): string {
    let path = "";
    for (const part of routeParts[i]) {
      if (part.kind === "text") {
        path += "/" + part.value;
        continue;
      }
      const value = params?.[part.value];
      const route = JSON.stringify(sourceRouteFiles[i]);
      if (value === undefined) {
        throw new Error(`Missing param ${JSON.stringify(part.value)} for route ${route}`);
      }
      // An empty catch-all value renders the route's own directory.
      if (part.kind === "catchAll" && $isJSArray(value) && value.every(v => typeof v === "string")) {
        for (const v of value) path += "/" + v;
      } else if (typeof value === "string" && (part.kind === "catchAll" || value.length > 0)) {
        path += "/" + value;
      } else {
        const expected = part.kind === "catchAll" ? "a string or an array of strings" : "a non-empty string";
        throw new Error(
          `Param ${JSON.stringify(part.value)} for route ${route} must be ${expected}, got ${Bun.inspect(value)}`,
        );
      }
    }
    return path;
  }

  async function doGenerateRoute(
    type: number,
    noClient: boolean,
    i: number,
    layouts: any[],
    pageModule: any,
    params: Params | null,
  ) {
    // A missing param is reported before the page renders.
    const dir = pathJoin(outBase, routePath(i, params));
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

    await Promise.all(Object.entries(files).map(([key, value]) => Bun.write(pathJoin(dir, key), value)));
  }

  let modulesForFiles = [];
  for (const fileList of files) {
    $assert(fileList.length > 0);
    if (fileList.length > 1) {
      let anyPromise = false;
      let loaded = fileList.map(
        id =>
          loadedModules[id] ?? ((anyPromise = true), import(allServerFiles[id]).then(mod => (loadedModules[id] = mod))),
      );
      modulesForFiles.push(anyPromise ? await Promise.all(loaded) : loaded);
    } else {
      const id = fileList[0];
      modulesForFiles.push([loadedModules[id] ?? (loadedModules[id] = await import(allServerFiles[id]))]);
    }
  }

  // Every failing route is reported, not only the first one to reject.
  const settled = await Promise.allSettled(
    modulesForFiles.map(async (modules, i) => {
      const typeAndFlag = typeAndFlags[i];
      const type = typeAndFlag & 0xff;
      const noClient = (typeAndFlag & 0b100000000) !== 0;

      let [pageModule, ...layouts] = modules;

      if (paramInformation[i] != null) {
        const getParam = getParams[type];
        $assert(getParam != null && $isCallable(getParam));
        const paramGetter: Bake.GetParamIterator = await getParam({
          pageModule,
          layouts,
        });
        let result;
        if (paramGetter[Symbol.asyncIterator] != undefined) {
          for await (const params of paramGetter) {
            result = doGenerateRoute(type, noClient, i, layouts, pageModule, params);
            if ($isPromise(result)) await result;
          }
        } else if (paramGetter[Symbol.iterator] != undefined) {
          for (const params of paramGetter) {
            result = doGenerateRoute(type, noClient, i, layouts, pageModule, params);
            if ($isPromise(result)) await result;
          }
        } else {
          await Promise.all(
            paramGetter.pages.map(params => doGenerateRoute(type, noClient, i, layouts, pageModule, params)),
          );
        }
      } else {
        await doGenerateRoute(type, noClient, i, layouts, pageModule, null);
      }
    }),
  );
  const errors = settled.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason);
  const { length: failed } = errors;
  if (failed === 1) throw errors[0];
  if (failed > 1) throw new AggregateError(errors, `${failed} routes failed to pre-render`);
}
