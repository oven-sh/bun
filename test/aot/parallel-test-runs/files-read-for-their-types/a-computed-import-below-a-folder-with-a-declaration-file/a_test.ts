import { test, spyOn, mock } from 'bun:test';
import type { Shape } from './lib/types';
import type { more } from './lib/more';
type More = typeof more;
const somebody: any = (globalThis as any).somebody ?? { run() { return 1; } };
spyOn(somebody, 'run');
const LIB = new URL('./lib/', import.meta.url);
test('a', async () => {
  const shape: Shape = { side: 1 };
  for (const file of JSON.parse('["real.ts","types.ts"]')) console.log('SEEN', Object.keys(await import(new URL(file, LIB).href)).join() || 'nothing');
  console.log('SEEN', shape.side);
});
