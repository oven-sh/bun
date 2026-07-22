import { spawn } from 'node:child_process';
const payload = process.argv[3];
const p = spawn(process.argv[2], ['--inspect-wait=0', '-e', "1"], { stdio: ['ignore','ignore','pipe'] });
let err = '';
p.stderr.on('data', d => {
  err += d;
  const m = err.match(/ws:\/\/127\.0\.0\.1:(\d+)\/([a-f0-9-]+)/);
  if (m && !p.dialed) { p.dialed = true; dial(m[0]); }
});
function dial(url) {
  const ws = new WebSocket(url);
  ws.onopen = () => ws.send(payload);
  ws.onmessage = e => { console.log(JSON.stringify(payload), '->', e.data); p.kill(); process.exit(0); };
}
setTimeout(() => { console.log(JSON.stringify(payload), '-> NO REPLY'); p.kill(); process.exit(2); }, 5000);
