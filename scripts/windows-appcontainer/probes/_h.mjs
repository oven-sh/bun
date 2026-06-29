// shared probe helpers: incremental output, watchdog, bounded waits.
let fails = 0, total = 0;
const detail = e => String(e && (e.code || e.name)) + ': ' + String((e && e.message) || '').slice(0, 140);
export const t = (name, fn) => { total++; try { const v = fn(); console.log('API OK  ', name, '::', String(v ?? '').slice(0, 100)); } catch (e) { fails++; console.log('API FAIL', name, '::', detail(e)); } };
export const ta = async (name, fn) => { total++; try { const v = await fn(); console.log('API OK  ', name, '::', String(v ?? '').slice(0, 100)); } catch (e) { fails++; console.log('API FAIL', name, '::', detail(e)); } };
export const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT ' + what)), ms))]);
export const done = name => { console.log(name + '_DONE', fails, 'failures of', total); process.exit(fails ? 1 : 0); };
setTimeout(() => { console.log('WATCHDOG_EXIT', fails, 'failures of', total); process.exit(3); }, 70000);
