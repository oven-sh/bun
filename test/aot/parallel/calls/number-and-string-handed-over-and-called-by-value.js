// Number and String handed to the methods of lists and called by value: every kind of value, no value at all, what runs code of the program and what it sees on the stack.
const out = [];
const show = v => typeof v + ':' + (Object.is(v, -0) ? '-0' : typeof v === 'symbol' ? v.description : String(v));
const t = f => { try { const v = f(); out.push(Array.isArray(v) ? v.map(show).join() : show(v)); } catch (e) { out.push(e.name); } };
const frames = e => String(e.stack).split('\n').slice(1).map(l => { const m = /^\s*at (?:async )?([^\s(]+) \(/.exec(l); return m ? m[1] : '<anonymous>'; });
const below = all => all.slice(0, 4).join(' < ');
const box = {};
box['k' + [].length] = [Number, String];
const texts = ['12', '', ' 12 ', '12px', '0x10', '1e3', '-0', '.5', 'Infinity', ' 7﻿', '9007199254740993', '1'.repeat(30), 'a' + 'b'.repeat(20), '一'];
const numbers = [0, -0, 7, -1, 0.5, 1e21, 1e-7, NaN, Infinity, -Infinity, 2147483648, 123456789012345680000];
const others = [undefined, null, true, false, 10n, -3n, [], [5], [1, 2], {}, { valueOf() { return 4; } }, { toString() { return '6'; } }, new Number(8), new String('9'), () => 1];
for (let round = 0; round < 3; round++) {
  const [number, string] = box.k0;
  t(() => texts.map(Number)); t(() => texts.map(String)); t(() => numbers.map(Number)); t(() => numbers.map(String));
  t(() => texts.map(number)); t(() => texts.map(string)); t(() => numbers.map(number)); t(() => numbers.map(string));
  for (const value of others) { t(() => [value].map(Number)); t(() => [value].map(String)); t(() => number(value)); t(() => string(value)); }
  t(() => [Symbol('s')].map(String)); t(() => [Symbol('s')].map(Number)); t(() => string(Symbol('s'))); t(() => number(Symbol('s')));
  t(() => number()); t(() => string()); t(() => number('3', '4', '5')); t(() => string(3, 4, 5));
  t(() => [1, , 3].map(String)); t(() => ['1', , '3'].map(Number)); t(() => ['1', '2'].filter(Number)); t(() => ['', 'x'].filter(String)); t(() => ['1', '0'].every(Number)); t(() => ['', '0'].some(String)); t(() => ['0', '5'].find(Number)); t(() => ['7', '8'].flatMap(Number));
  t(() => number.call(null, '11')); t(() => string.apply(null, [11])); t(() => number.bind(null)('13')); t(() => Reflect.apply(string, undefined, [13]));
  t(() => typeof new number('1')); t(() => typeof new string(1)); t(() => Array.from(['1', '2'], Number)); t(() => Array.from([1, 2], String));
  let seen = '';
  function outermost(callback, value) { const made = [value].map(callback); return made; }
  t(() => { outermost(Number, { valueOf() { seen = below(frames(new Error('x'))); return 1; } }); return seen; });
  t(() => { outermost(String, { toString() { seen = below(frames(new Error('x'))); return 'x'; } }); return seen; });
  t(() => { try { outermost(Number, Symbol('s')); } catch (e) { return below(frames(e)); } });
  t(() => { let s = ''; for (let i = 0; i < 3; i++) [{ valueOf() { s = below(frames(new Error('x'))); return i; } }, '4', 5].map(Number); return s; });
  t(() => { let s = ''; for (let i = 0; i < 3; i++) [{ toString() { s = below(frames(new Error('x'))); return 'x'; } }, '4', 5].map(String); return s; });
  t(() => { let s = ''; for (let i = 0; i < 3; i++) { try { ['1', Symbol('s')].map(Number); } catch (e) { s = e.name + ' ' + below(frames(e)); } } return s; });
  t(() => { let s = 0; for (let i = 0; i < 3; i++) s += [i, '', 'x', 0, null, {}].filter(Boolean).length; return s; });
  t(() => { try { outermost(Number, { valueOf() { throw new RangeError('r'); } }); } catch (e) { return e.name + ' ' + below(frames(e)); } });
}
console.log(out.join('\n'));
