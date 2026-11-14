import { test, jest } from 'bun:test';
jest.spyOn(process, 'umask').mockReturnThis();
const held = process.umask();
test('the receiver keeps its members', () => {
  console.log('SAID', held === process, typeof held.allowedNodeEnvironmentFlags, typeof held.constrainedMemory);
});
