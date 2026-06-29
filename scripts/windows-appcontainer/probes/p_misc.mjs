// p_misc: workers, sqlite, ffi, watch events, tty, terminal/pty.
import fs from 'node:fs';
import path from 'node:path';
import tty from 'node:tty';
import { t, ta, withTimeout, done } from './_h.mjs';

await ta('node:worker_threads roundtrip', () => withTimeout((async () => {
  const { Worker } = await import('node:worker_threads');
  fs.writeFileSync(path.resolve('w1.mjs'), 'import {parentPort} from "node:worker_threads"; parentPort.on("message", m => parentPort.postMessage("pong:"+m));');
  return await new Promise((res, rej) => {
    const w = new Worker(path.resolve('w1.mjs'));
    w.on('message', m => { res(m); w.terminate(); });
    w.on('error', rej);
    w.postMessage('hi');
  });
})(), 30000, 'node-worker'));
await ta('web Worker roundtrip', () => withTimeout((async () => {
  fs.writeFileSync(path.resolve('w2.mjs'), 'self.onmessage = e => postMessage("wpong:" + e.data);');
  return await new Promise((res, rej) => {
    const w = new Worker(path.resolve('w2.mjs'));
    w.onmessage = e => { res(e.data); w.terminate(); };
    w.onerror = e => rej(new Error('worker error: ' + (e && e.message)));
    w.postMessage('hi');
  });
})(), 30000, 'web-worker'));
await ta('bun:sqlite memory', async () => { const { Database } = await import('bun:sqlite'); const d = new Database(':memory:'); d.run('create table t(a)'); d.run('insert into t values (42)'); const v = d.query('select a from t').get(); d.close(); return JSON.stringify(v); });
await ta('bun:sqlite file', async () => { const { Database } = await import('bun:sqlite'); const d = new Database('probe.sqlite'); d.run('create table if not exists t(a)'); d.run('insert into t values (7)'); const v = d.query('select count(*) n from t').get(); d.close(); return JSON.stringify(v); });
await ta('bun:ffi dlopen kernel32', async () => { const { dlopen } = await import('bun:ffi'); const l = dlopen('kernel32.dll', { GetCurrentProcessId: { args: [], returns: 'u32' } }); const v = l.symbols.GetCurrentProcessId(); l.close(); return 'pid=' + v; });
await ta('bun:ffi cc (tinycc)', async () => { const { cc } = await import('bun:ffi'); fs.writeFileSync(path.resolve('cc1.c'), 'int addup(int a, int b) { return a + b; }'); const { symbols } = cc({ source: './cc1.c', symbols: { addup: { args: ['int', 'int'], returns: 'int' } } }); return 'sum=' + symbols.addup(2, 3); });
await ta('fs.watch event roundtrip', () => withTimeout(new Promise((res, rej) => {
  const w = fs.watch('.', (ev, f) => { if (f && f.includes('watched')) { w.close(); res(ev + ':' + f); } });
  setTimeout(() => fs.writeFileSync('watched.txt', 'x'), 50);
}), 15000, 'fs.watch'));
t('tty.isatty(0/1/2)', () => [0, 1, 2].map(f => tty.isatty(f)).join(','));
t('process.stdout.isTTY', () => String(process.stdout.isTTY) + ' cols=' + process.stdout.columns);
t('typeof Bun.Terminal', () => String(typeof Bun.Terminal));
await ta('Bun.Terminal(pty)+spawn', () => withTimeout((async () => {
  if (typeof Bun.Terminal !== 'function') return 'n/a';
  let out = '';
  const term = new Bun.Terminal({ cols: 80, rows: 25, data(t2, chunk) { out += new TextDecoder().decode(chunk); } });
  const p = Bun.spawn({ cmd: ['cmd', '/c', 'echo frompty'], terminal: term });
  await p.exited; await Bun.sleep(300); term.close();
  return ('exit=' + p.exitCode + ' out=' + out.replace(/\s+/g, ' ')).slice(0, 90);
})(), 30000, 'pty'));
await ta('AsyncLocalStorage', async () => { const { AsyncLocalStorage } = await import('node:async_hooks'); const a = new AsyncLocalStorage(); return a.run(7, async () => { await Bun.sleep(1); return 'v=' + a.getStore(); }); });
await ta('MessageChannel', () => withTimeout(new Promise(res => { const { port1, port2 } = new MessageChannel(); port2.onmessage = e => { port1.close(); port2.close(); res('mc:' + e.data); }; port1.postMessage('x'); }), 10000, 'mc'));
t('Bun.Transpiler', () => new Bun.Transpiler({ loader: 'ts' }).transformSync('const x: number = 1').trim());
await ta('import .ts with types', async () => (await import('./lib_ts.ts')).tsval());
await ta('import over http (expect reject)', async () => { try { await import('http://127.0.0.1:1/x.js'); return 'loaded'; } catch (e) { return 'rejected: ' + (e && (e.code || e.name)); } });
done('P_MISC');
