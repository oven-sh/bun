// p_spawn2: Bun.spawn stdio/flag matrix to isolate which option fails in the AC.
import { ta, withTimeout, done } from './_h.mjs';
const V = (name, opts) => ta(name, () => withTimeout((async () => { const p = Bun.spawn({ cmd: ['cmd', '/c', 'echo x'], ...opts }); const code = await p.exited; return 'exit=' + code; })(), 15000, name));
await V('Bun.spawn defaults', {});
await V('in=ignore out=pipe err=pipe', { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
await V('in=pipe out=pipe err=pipe', { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
await V('in=inherit out=pipe err=pipe', { stdin: 'inherit', stdout: 'pipe', stderr: 'pipe' });
await V('all inherit', { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
await V('all ignore', { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
await V('all pipe', { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' });
await V('windowsHide=false out=pipe', { windowsHide: false, stdout: 'pipe' });
await V('detached out=pipe', { detached: true, stdout: 'pipe' });
await ta('spawnSync defaults', async () => { const r = Bun.spawnSync({ cmd: ['cmd', '/c', 'echo x'] }); return 'ex=' + r.exitCode; });
await ta('spawnSync all inherit', async () => { const r = Bun.spawnSync({ cmd: ['cmd', '/c', 'echo x'], stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' }); return 'ex=' + r.exitCode; });
await ta('spawnSync all pipe', async () => { const r = Bun.spawnSync({ cmd: ['cmd', '/c', 'echo x'], stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' }); return 'ex=' + r.exitCode; });
await ta('spawnSync in=buffer', async () => { const r = Bun.spawnSync({ cmd: ['findstr', 'x'], stdin: Buffer.from('x\n'), stdout: 'pipe' }); return 'ex=' + r.exitCode + ' ' + r.stdout.toString().trim(); });
done('P_SPAWN2');
