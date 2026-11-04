import { test, spyOn, mock } from 'bun:test';
import type { Shape } from './lib/types';
import type { more } from './lib/more';
type More = typeof more;
const LIB = new URL('./lib/', import.meta.url);
const names = (text: string): string[] => JSON.parse(text);
const somebody: any = (globalThis as any).somebody ?? { run() { return 1; } };
spyOn(somebody, 'run');
test('a', async () => {
  const shape: Shape = { side: 1 };
  for (const file of names('["more.d.ts","real.ts"]')) console.log('SEEN', Object.keys(await import(new URL(file, LIB).href)).join() || 'nothing');
  console.log('SEEN', shape.side);
});
