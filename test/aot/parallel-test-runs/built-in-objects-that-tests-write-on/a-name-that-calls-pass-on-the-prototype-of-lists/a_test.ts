import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string) { Object.defineProperty(Array.prototype, name, { value, configurable: true }); }
test('a', () => {
  put('extra', 'x'); console.log('SEEN', list('extra'), read('extra')); drop(Array.prototype, 'extra');
});
