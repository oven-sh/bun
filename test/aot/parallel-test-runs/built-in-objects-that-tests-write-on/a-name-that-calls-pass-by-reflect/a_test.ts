import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string): Disposable {
  Reflect.defineProperty(Object.prototype, name, { value, configurable: true });
  return { [Symbol.dispose]() { delete (Object.prototype as any)[name]; } };
}
function set(name: string, value: string) { Reflect.set(Object.prototype, name, value); }
test('a', () => {
  { using _ = put('one', 'x'); console.log('SEEN', read('one')); }
  set('two', 'y'); console.log('SEEN', read('one'), read('two')); drop(Object.prototype, 'two');
});
