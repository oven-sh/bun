import { jest, test } from 'bun:test';
import { readsThis } from './helper.js';
const wrapped = jest.fn(readsThis);
Object.defineProperty(process, 'umask', { get: wrapped, configurable: true });
const held = process.umask;
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
