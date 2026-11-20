import { expect, test, vi } from 'bun:test';
import { placeOfTheRun } from './place-of-the-run';

vi.mock('node:process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:process')>()),
  cwd: () => '/orchard',
}));

test('a factory that keeps the rest of the original', () => {
  console.log(placeOfTheRun());
  expect(placeOfTheRun()).toBe('/orchard function');
});
