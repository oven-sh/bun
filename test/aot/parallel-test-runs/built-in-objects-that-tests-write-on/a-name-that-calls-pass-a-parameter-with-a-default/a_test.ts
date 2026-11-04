import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(value: string, name = 'standard') { Object.defineProperty(Object.prototype, name, { value, configurable: true }); }
test('a', () => {
  put('x'); put('y', 'other'); console.log('SEEN', read('standard'), read('other')); drop(Object.prototype, 'standard'); drop(Object.prototype, 'other');
});
