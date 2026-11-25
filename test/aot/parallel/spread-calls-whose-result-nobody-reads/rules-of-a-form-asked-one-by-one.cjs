// What a spread call gives is read on one way and dropped on the other; the callee is a member, a value out of a table, bound, optional, or asked through apply. Each choice ends in a jump that hands on nothing.
'use strict';
const log = [];
const checks = { atLeast(n, v) { log.push('least'); return v >= n; }, oneOf(v, ...all) { log.push('one' + all.length); return all.includes(v); }, note(...all) { log.push('note' + all.length); } };
function ask(form, key, rule) {
  const value = form[key], [name, ...args] = rule;
  let failed = false;
  if (name === 'oneOf') failed = !checks.oneOf(value, ...args); else if (name === 'atLeast') failed = !checks[name](...args, value); else checks[name]?.(...args);
  failed ? checks.note(key, ...args) : rule.after && rule.after(...args);
  failed && form.onFail ? form.onFail(...args, key) : null;
  return failed;
}
function every(form, rules) { let wrong = 0; for (const key in rules) for (const rule of rules[key]) ask(form, key, rule) ? wrong++ : rule.count ? wrong-- : 0; return wrong; }
function passed(f, list, read) { const got = read ? f(...list) : void f(...list); read ? 0 : f.apply(null, list); return got; }
function bound(f, list, n) { const g = f.bind(null, n); n ? g(...list) : f(...list, n); (n > 1 ? g : f)(...list); }
const rules = { age: [['atLeast', 18], ['note']], size: [['oneOf', 's', 'm', 'l'], Object.assign(['none', 1], { count: true })], name: [Object.assign(['atLeast', 'b'], { after: (...a) => log.push('after' + a.join()) })] };
const forms = [{ age: 20, size: 'm', name: 'cy' }, { age: 3, size: 'x', name: 'a' }, { age: '18', size: undefined, name: null, onFail(...why) { log.push(this.age + '!' + why.join()); } }, {}];
for (let k = 0; k < 60; k++) { for (const form of forms) every(form, rules); passed(checks.note, [k], k & 1); bound(checks.note, [1, 2], k % 3); log.length = 0; }
for (const form of forms) { console.log(every(form, rules), log.splice(0).join(' ')); }
console.log(passed(Math.max, [3, 9, 4], true), passed(Math.max, [3, 9, 4], false), passed((...a) => a.length, new Set('abc'), 1), log.length);
bound(checks.note, [5], 0); bound(checks.note, [5], 1); bound(checks.note, [5, 6], 2); console.log(log.splice(0).join(' '));
const told = run => { try { return String(run()); } catch (error) { return error.constructor.name; } };
console.log(told(() => every({}, { a: [[]] })), told(() => every({}, { a: [['constructor', 1]] })), told(() => every({}, { a: [null] })), told(() => every(null, rules)), told(() => passed(null, [1], 0)), told(() => passed(() => 1, null, 1)), told(() => every({ a: 1, onFail: 3 }, { a: [['atLeast', 2]] })));
checks.atLeast = (...all) => { log.push('other' + all.length); throw new TypeError('no'); }; console.log(told(() => every(forms[0], rules)), log.splice(0).join(' ')); delete checks.note; checks.atLeast = undefined; console.log(told(() => every(forms[1], { size: rules.size })), told(() => every(forms[1], { age: rules.age })), log.splice(0).join(' '));
const order = []; const traced = new Proxy({ age: 1 }, { get(o, k) { order.push(String(k)); return k === 'onFail' ? (...a) => order.push(a.join()) : o[k]; } }); checks.note = () => order.push('note'); checks.oneOf = (v, ...all) => all.length > 2; console.log(told(() => every(traced, { age: [['oneOf', 1], ['oneOf', 1, 2, 3]] })), order.join(' '));
