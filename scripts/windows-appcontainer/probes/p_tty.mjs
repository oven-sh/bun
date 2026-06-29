// p_tty: ConPTY (Bun.Terminal) + console tty reads inside the container.
// Bun.Terminal creates \\.\pipe\bun-conpty-<pid>-<n> (no LOCAL\ prefix) so this
// is expected to fail in an AppContainer until that name is prefixed.
import { t, ta, withTimeout, done } from './_h.mjs';
t('typeof Bun.Terminal', () => typeof Bun.Terminal);
await ta('conpty child tty read roundtrip', () => withTimeout((async () => {
  let out = '';
  const term = new Bun.Terminal({ cols: 80, rows: 25, data(t2, c) { out += new TextDecoder().decode(c); } });
  const code = 'process.stdin.setRawMode(true);process.stdin.resume();process.stdin.once("data",d=>{process.stdout.write("GOT["+d+"]");process.exit(0)});';
  const p = Bun.spawn({ cmd: [process.execPath, '-e', code], terminal: term, env: { ...process.env, BUN_DEBUG_QUIET_LOGS: '1' } });
  await Bun.sleep(1500);
  term.write('z');
  const ex = await withTimeout(p.exited, 20000, 'child-exit');
  await Bun.sleep(300);
  term.close();
  return ('exit=' + ex + ' out=' + out.replace(/\s+/g, ' ')).slice(0, 120);
})(), 40000, 'conpty-tty'));
await ta('conpty child rawmode toggle + exit w/ pending read', () => withTimeout((async () => {
  let out = '';
  const term = new Bun.Terminal({ cols: 80, rows: 25, data(t2, c) { out += new TextDecoder().decode(c); } });
  const code = 'process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setRawMode(false);process.stdin.setRawMode(true);setTimeout(()=>{console.log("BYE");process.exit(0)},500);';
  const p = Bun.spawn({ cmd: [process.execPath, '-e', code], terminal: term, env: { ...process.env, BUN_DEBUG_QUIET_LOGS: '1' } });
  const ex = await withTimeout(p.exited, 25000, 'child-exit2');
  await Bun.sleep(200);
  term.close();
  return 'exit=' + ex + ' sawBye=' + out.includes('BYE');
})(), 40000, 'conpty-toggle'));
done('P_TTY');
