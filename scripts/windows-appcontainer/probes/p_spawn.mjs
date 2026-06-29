// p_spawn: process spawning, pipes, shell, IPC. This is where the libuv AppContainer
// pipe-name fix matters (uv_spawn stdio pipes, uv_pipe(), IPC channel).
import { spawnSync, spawn, exec, execSync, fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { t, ta, withTimeout, done } from './_h.mjs';

t('cp.spawnSync(cmd /c echo)', () => { const r = spawnSync('cmd', ['/c', 'echo hi'], { encoding: 'utf8' }); if (r.error) throw r.error; return 'status=' + r.status + ' out=' + String(r.stdout).trim(); });
t('cp.execSync', () => execSync('echo viaexec', { encoding: 'utf8' }).trim());
await ta('cp.spawn(pipes)', () => withTimeout(new Promise((res, rej) => { const c = spawn('cmd', ['/c', 'echo piped']); let s = ''; c.stdout.on('data', d => s += d); c.on('error', rej); c.on('close', code => res('code=' + code + ' out=' + s.trim())); }), 20000, 'cp.spawn'));
await ta('cp.exec', () => withTimeout(new Promise((res, rej) => exec('echo fromexec', (e, so) => e ? rej(e) : res(so.trim()))), 20000, 'cp.exec'));
await ta('cp.spawn(stdio inherit)', () => withTimeout(new Promise((res, rej) => { const c = spawn('cmd', ['/c', 'exit 7'], { stdio: 'inherit' }); c.on('error', rej); c.on('close', code => res('code=' + code)); }), 20000, 'inherit'));
await ta('Bun.spawnSync(pipe)', async () => { const r = Bun.spawnSync({ cmd: ['cmd', '/c', 'echo bunspawnsync'] }); return 'ex=' + r.exitCode + ' out=' + r.stdout.toString().trim(); });
await ta('Bun.spawn(pipe)+text', () => withTimeout((async () => { const p = Bun.spawn({ cmd: ['cmd', '/c', 'echo bunspawn2'], stdout: 'pipe' }); const t2 = await p.stdout.text(); await p.exited; return t2.trim() + ' ex=' + p.exitCode; })(), 20000, 'Bun.spawn'));
await ta('Bun.spawn(self -e)+stdin', () => withTimeout((async () => { const p = Bun.spawn({ cmd: [process.execPath, '-e', 'process.stdin.on("data",d=>{process.stdout.write("got:"+d);process.exit(0)})'], stdout: 'pipe', stdin: 'pipe', env: { ...process.env } }); p.stdin.write('ping'); await p.stdin.end(); const out = await p.stdout.text(); await p.exited; return out + ' ex=' + p.exitCode; })(), 30000, 'spawn-self'));
await ta('Bun.$ builtin echo', () => withTimeout((async () => { const r = await Bun.$`echo shellhi`.quiet(); return r.stdout.toString().trim(); })(), 20000, 'shell-echo'));
await ta('Bun.$ external pipeline', () => withTimeout((async () => { const r = await Bun.$`cmd /c echo pipeme | cmd /c findstr pipeme`.quiet(); return r.stdout.toString().trim(); })(), 20000, 'shell-pipe'));
await ta('Bun.$ redirect to file', () => withTimeout((async () => { await Bun.$`echo redirected > shellout.txt`.quiet(); return (await Bun.file('shellout.txt').text()).trim(); })(), 20000, 'shell-redir'));
await ta('cp.spawn(self -e)+ipc', () => withTimeout(new Promise((res, rej) => {
  const c = spawn(process.execPath, ['-e', 'process.on("message",m=>{process.send({echo:m});setTimeout(()=>process.exit(0),30)});process.send("ready")'], { stdio: ['inherit', 'inherit', 'inherit', 'ipc'], env: { ...process.env } });
  const got = []; c.on('error', rej);
  c.on('message', m => { got.push(JSON.stringify(m)); if (got.length === 1) c.send('ping'); else res(got.join(',')); });
  c.on('exit', code => { if (got.length < 2) rej(new Error('exited early code=' + code + ' got=' + got)); });
}), 30000, 'ipc'));
await ta('cp.fork(file)+ipc', () => withTimeout(new Promise((res, rej) => {
  fs.writeFileSync(path.resolve('ipc_child.mjs'), 'process.on("message",m=>{process.send({echo:m});setTimeout(()=>process.exit(0),30)});process.send("ready");');
  const c = fork('./ipc_child.mjs', [], { env: { ...process.env } });
  const got = []; c.on('error', rej);
  c.on('message', m => { got.push(JSON.stringify(m)); if (got.length === 1) c.send('ping'); else res(got.join(',')); });
  c.on('exit', code => { if (got.length < 2) rej(new Error('exited early code=' + code + ' got=' + got)); });
}), 30000, 'fork'));
done('P_SPAWN');
