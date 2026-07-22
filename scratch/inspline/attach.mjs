import { spawn } from 'node:child_process';
const p = spawn(process.argv[2], ['--inspect=0', 'idle.js'], { stdio: ['ignore','ignore','pipe'] });
let err = '';
p.stderr.on('data', d => {
  err += d;
  const m = err.match(/Debugger listening on (ws:\/\/[^\s]+)/);
  if (m && !p.dialed) { p.dialed = true; dial(m[1]); }
});
function dial(url) {
  const ws = new WebSocket(url);
  ws.onopen = () => setTimeout(() => { ws.close(); }, 300);
  ws.onclose = () => setTimeout(() => { console.log(JSON.stringify(err)); p.kill(); process.exit(0); }, 400);
}
setTimeout(() => { console.log('TIMEOUT', JSON.stringify(err)); p.kill(); process.exit(2); }, 6000);
