import { expect, jest, test, vi } from 'bun:test';

test('every name of what requireActual() gives', () => {
  const loader = jest.requireActual('node:module') as Record<string, unknown>;
  const kinds = new Map(Object.entries(loader).map(([name, value]) => [name, typeof value]));
  console.log(kinds.get('createRequire'), kinds.get('wrapper'), kinds.get('builtinModules'));
  expect(kinds.size).toBeGreaterThan(10);
});

test('a walk over what importActual() gives', async () => {
  const loader = await vi.importActual<Record<string, unknown>>('node:module');
  let functions = 0;
  for (const name in loader) {
    if (typeof loader[name] === 'function') functions++;
  }
  console.log(functions > 5, typeof loader.wrapper);
  expect(functions).toBeGreaterThan(5);
});
