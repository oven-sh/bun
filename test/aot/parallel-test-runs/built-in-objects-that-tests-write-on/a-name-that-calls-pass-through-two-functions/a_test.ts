import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function inner(name: string, value: string) { Object.defineProperty(Object.prototype, name, { value, configurable: true }); }
function outer(name: string) { inner(name, 'deep'); }
test('a', () => {
  outer('twice'); console.log('SEEN', read('twice')); drop(Object.prototype, 'twice');
});
