import { expect, test, vi } from 'bun:test';

test('a mock that importMock() makes', async () => {
  const loader = await vi.importMock<Record<string, unknown>>('node:module');
  console.log(typeof loader.createRequire, typeof loader.isBuiltin);
  expect(typeof loader.createRequire).toBe('function');
});
