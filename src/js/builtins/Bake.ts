//! JS code for bake
/// <reference path="../../bake/bake.d.ts" />
import type { Bake } from "bun";

type RenderStatic = Bake.ServerEntryPoint['staticRender'];

/**
 * This layer is implemented in JavaScript to reduce Native <-> JS context switches,
 * and 
 */
export function renderRoutesForProd(
  outBase: string,
  renderStatic: RenderStatic,
  files: string[],
  patterns: string[],
  styles: string[][],
): Promise<void> {
  const { join: pathJoin } = require('node:path');

  return Promise.all(files.map(async(file, i) => {
    const pattern = patterns[i];
    const route = await import(file);
    const results = await renderStatic(route, {
      scripts: [],
      styles: styles[i],
    });
    if (!results || typeof results !== 'object') {
      // TODO: retrieve original filename
      throw new Error(`Rendering route ${JSON.stringify(pattern)} did not return an object, got ${Bun.inspect(results)}`);
    }
    await Promise.all(Object.entries(results).map(([key, value]) => Bun.write(pathJoin(outBase, pattern + key), value)));
  }));
}