import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string) { Object.defineProperty(Object.prototype, name, { value, configurable: true }); }
test('a', () => {
  put('a1', 'x'); put('a2', 'y'); put('a3', 'z'); console.log('SEEN', read('a1'), read('a2'), read('a3'));
  drop(Object.prototype, 'a1'); drop(Object.prototype, 'a2'); drop(Object.prototype, 'a3');
});
