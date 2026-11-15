import { test, spyOn, mock } from 'bun:test';
import type { Shape } from './lib/types';
import type { more } from './lib/more';
type More = typeof more;
const LIB = new URL('./lib/', import.meta.url);
const names = (text: string): string[] => JSON.parse(text);
test('a', async () => {
  const shape: Shape = { side: 1 };
  for (const file of names('["real.ts"]')) { const it = await import(new URL(file, LIB).href); spyOn(it, names('["real"]')[0]).mockReturnValue('spied'); console.log('SEEN', it.real()); }
  console.log('SEEN', shape.side);
});
