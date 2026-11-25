import { test } from 'bun:test';
Object.assign(process, { umask() { return super.valueOf(); } });
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
