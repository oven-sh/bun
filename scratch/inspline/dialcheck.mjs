import { spawn } from 'node:child_process';
const p = spawn('../../build/release/bun', ['--inspect=0', 'idle.js'], { stdio: ['ignore','ignore','pipe'] });
let err = '';
p.stderr.on('data', d => {
  err += d;
  const m = err.match(/Debugger listening on (ws:\/\/[^\s]+)/);
  if (m) dial(m[1]);
});
function dial(url) {
  const ws = new WebSocket(url);
  ws.onopen = () => { console.log('DIAL OK', new URL(url).host); ws.close(); p.kill(); process.exit(0); };
  ws.onerror = e => { console.log('DIAL FAIL', e.message ?? e); p.kill(); process.exit(1); };
}
setTimeout(() => { console.log('TIMEOUT'); p.kill(); process.exit(2); }, 5000);
