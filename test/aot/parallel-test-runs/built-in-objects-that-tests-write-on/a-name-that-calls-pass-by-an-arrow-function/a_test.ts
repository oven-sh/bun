import { test } from 'bun:test';
import { read, list, keys } from './src/app';
function drop(holder: object, name: string) { Reflect.deleteProperty(holder, name); }
const put = (name: string, value: string) => { Object.defineProperty(Object.prototype, name, { value, configurable: true }); };
test('a', () => {
  put('arrow', 'x'); console.log('SEEN', read('arrow')); drop(Object.prototype, 'arrow');
});
