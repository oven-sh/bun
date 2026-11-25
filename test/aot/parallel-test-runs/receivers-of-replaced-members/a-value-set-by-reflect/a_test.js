import { test } from 'bun:test';
Reflect.set(process, 'umask', function () { return this; });
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
