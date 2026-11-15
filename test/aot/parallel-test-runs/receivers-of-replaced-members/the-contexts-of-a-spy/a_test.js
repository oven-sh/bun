import { test, vi } from 'bun:test';
const spy = vi.spyOn(process, 'umask');
process.umask();
const held = spy.mock.contexts[0];
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
