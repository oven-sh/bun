import { test } from 'bun:test';
const answer = function () { return this; };
Reflect.defineProperty(process, 'umask', { value: answer, configurable: true });
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
