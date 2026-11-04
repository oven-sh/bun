import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
function put(name: string, value: string): Disposable {
  (Object.prototype as any)[name] = value;
  return { [Symbol.dispose]() { delete (Object.prototype as any)[name]; } };
}
test('a', () => {
  { using _ = put('polluted', 'x'); console.log('SEEN', read('polluted'), keys()); }
  console.log('SEEN', read('polluted'), keys());
});
