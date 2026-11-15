import { test, mock, vi, jest } from 'bun:test';
globalThis.kept ??= [];
const say = (...a) => console.log('R', ...a);
const attempt = f => { try { return f(); } catch (e) { return '!' + e?.constructor?.name; } };
const all = async m => `${m.at} ${attempt(() => m.read())} ${attempt(() => m.keys())} ${attempt(() => m.again)} ${attempt(() => m.twice?.())} ${await m.same()}`;
import './service.mjs';
test('a', () => {});
