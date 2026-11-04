import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
import { pollute, clean } from './help';
test('a', () => {
  pollute(); console.log('SEEN', read('helped')); clean(); console.log('SEEN', read('helped'));
});
