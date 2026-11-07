import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string) { Object.defineProperty(Object.prototype, name, { value, configurable: true }); }
test('a', () => {
  for (const name of ['b1', 'b2'] as const) put(name, 'x'); console.log('SEEN', read('b1'), read('b2'));
  drop(Object.prototype, 'b1'); drop(Object.prototype, 'b2');
});
