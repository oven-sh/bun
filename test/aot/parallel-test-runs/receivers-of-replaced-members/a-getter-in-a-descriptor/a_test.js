import { test } from 'bun:test';
Object.defineProperty(process, 'umask', { get() { return this; }, configurable: true });
const held = process.umask;
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
