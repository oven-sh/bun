//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />
import type { Bake } from "bun";

type RenderStatic = Bake.ServerEntryPoint["prerender"];
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
  renderStatic: RenderStatic[],
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
        pageModule = loadedModules[id] ?? (loadedModules[id] = await import(allServerFiles[fileList[0]]));
        layouts = [];
      }

      if (paramInformation[i] != null) {
        throw new Error("TODO: call the framework to get the param information");
      }

      // Call the framework's rendering function
      const callback = renderStatic[type];
      $assert(callback != null && $isCallable(callback));
      const results = await callback({
        scripts: [clientEntryUrl[type]],
        modulepreload: [],
        styles: styles[i],
        layouts,
        pageModule,
        params: null,
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
          return Bun.write(pathJoin(outBase, patterns[i] + key), value);
        }),
      );
    }),
  );
}
