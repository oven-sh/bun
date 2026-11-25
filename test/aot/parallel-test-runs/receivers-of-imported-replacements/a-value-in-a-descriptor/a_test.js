import { test } from 'bun:test';
import { readsThis } from './helper.js';
Object.defineProperty(process, 'umask', { value: readsThis, configurable: true });
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
