import { test, spyOn, mock } from 'bun:test';
import type { Shape, real } from 'pkg/core/real';
const PKG = new URL('../node_modules/pkg/', import.meta.url);
async function load(file: string): Promise<Real> { const module: { real: Real } = await import(new URL(file, PKG).href); return module.real; }
type Real = typeof real;
test('a', async () => {
  const shape: Shape = { side: 1 };
  for (const file of JSON.parse('["core/real.mjs","core/real.js","src/core/real.ts"]')) console.log('SEEN', (await load(file))());
  console.log('SEEN', shape.side);
});
