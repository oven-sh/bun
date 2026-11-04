import { test, spyOn, mock } from 'bun:test';
import type { Shape } from './lib/types';
import type { more } from './lib/more';
type More = typeof more;
const LIB = new URL('./lib/', import.meta.url);
const names = (text: string): string[] => JSON.parse(text);
test('a', async () => {
  const shape: Shape = { side: 1 };
  mock.module('./lib/more', () => ({ more: 7 }));
  for (const file of names('["real.ts"]')) console.log('SEEN', Object.keys(await import(new URL(file, LIB).href)).join() || 'nothing');
  console.log('SEEN', (await import('./lib/' + names('["more"]')[0])).more);
  console.log('SEEN', shape.side);
});
