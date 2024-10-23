//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />
import type { Bake } from "bun";

type RenderStatic = Bake.ServerEntryPoint['staticRender'];

/**
 * This layer is implemented in JavaScript to reduce Native <-> JS context switches,
 * and 
 */
export async function renderRoutesForProd(outBase: string, renderStatic: RenderStatic, files: string[]): Promise<void> {
  const { resolve: pathResolve } = require('node:path');

  await Promise.all(files.map(async(file) => {
    const route = await import(file);
    const results = await renderStatic(route, {
      scripts: [],
      styles: [],
    });
    if (!results || typeof results !== 'object') {
      // TODO: retrieve original filename
      throw new Error(`Rendering route ${JSON.stringify(file)} did not return an object, got ${Bun.inspect(results)}`);
    }
    await Promise.all(Object.entries(results).map(([key, value]) => Bun.write(pathResolve(outBase + key), value)));
  }));
}