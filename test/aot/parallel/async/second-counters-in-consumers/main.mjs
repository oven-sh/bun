import { lines, show, log, attempt, setAcc, acc, box, list0, table, KEY, x, P, Q, R, gen, gen2, hand, wrap, wrap2, structured } from './state.mjs';
import { cb, pass, via, port0 } from './ports.mjs';

export function main() { attempt('0', () => cb(new Q(x, 's'), 2)); attempt('1', () => pass(new R(), 1)); attempt('2', () => pass([{ k: x }, { k: 'o' }], 2)); attempt('3', () => via(Object.assign(new R(), { k: 4 }), 1)); attempt('4', () => via([[x], [2]], 3)); attempt('5', () => cb({ __proto__: null, k: 3 }, 2));
lines.push('end ' + show([acc, list0.length, table.size]));
console.log(lines.join('\n'));
}
main();
