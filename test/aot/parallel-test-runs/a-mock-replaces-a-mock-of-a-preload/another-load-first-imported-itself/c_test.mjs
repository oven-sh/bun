import { test } from 'bun:test';
const show = (n, o) => { let t, v; try { t = typeof o.set; } catch (e) { t = '!' + e.message.slice(0, 24); } try { v = o.val; } catch (e) { v = '!' + e.message.slice(0, 24); } console.log('SAID', n, t, v); };
test('c', async () => { show('c', await import('./e.mjs')); });
