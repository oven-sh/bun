import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string): Disposable {
  Object.defineProperty(Object.prototype, name, { value, configurable: true, enumerable: true, writable: true });
  return { [Symbol.dispose]() { delete (Object.prototype as any)[name]; } };
}
test('a', () => {
  { using _ = put('HTTPS_PROXY', 'x'); console.log('SEEN', read('HTTPS_PROXY'), keys()); }
  console.log('SEEN', read('HTTPS_PROXY'), keys());
});
