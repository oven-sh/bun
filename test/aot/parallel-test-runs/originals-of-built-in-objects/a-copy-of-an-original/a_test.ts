import { expect, jest, test } from 'bun:test';

test('a copy of what requireActual() gives', () => {
  expect(typeof { ...jest.requireActual('node:process') }.cwd).toBe('function');
});
