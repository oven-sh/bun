// p_net: in-process loopback networking (TCP, HTTP, WebSocket) + named pipes.
import net from 'node:net';
import http from 'node:http';
import { ta, withTimeout, done } from './_h.mjs';

await ta('net.server+client loopback', () => withTimeout(new Promise((res, rej) => {
  const srv = net.createServer(s => { s.end('pong'); });
  srv.on('error', rej);
  srv.listen(0, '127.0.0.1', () => {
    const { port } = srv.address();
    const c = net.connect(port, '127.0.0.1', () => c.write('ping'));
    let d = ''; c.on('data', x => d += x); c.on('error', rej);
    c.on('end', () => { srv.close(); res('got=' + d + ' port=' + port); });
  });
}), 15000, 'net-loopback'));
await ta('Bun.listen+Bun.connect tcp', () => withTimeout((async () => {
  let resolve, got = new Promise(r => resolve = r);
  const srv = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data(s, d) { s.write('pong'); s.flush(); }, error() {} } });
  const sock = await Bun.connect({ hostname: '127.0.0.1', port: srv.port, socket: { data(s, d) { resolve(d.toString()); }, error() {} } });
  sock.write('ping'); sock.flush();
  const g = await got; sock.end(); srv.stop(true);
  return 'got=' + g;
})(), 15000, 'bun-listen'));
await ta('Bun.serve+fetch self', () => withTimeout((async () => {
  const srv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('served') });
  const r = await fetch('http://127.0.0.1:' + srv.port + '/');
  const t2 = await r.text(); srv.stop(true);
  return r.status + ' ' + t2;
})(), 15000, 'bun-serve'));
await ta('Bun.serve+fetch localhost-name', () => withTimeout((async () => {
  const srv = Bun.serve({ port: 0, fetch: () => new Response('servedlh') });
  const r = await fetch(srv.url);
  const t2 = await r.text(); srv.stop(true);
  return r.status + ' ' + t2 + ' ' + srv.url;
})(), 15000, 'bun-serve-lh'));
await ta('node:http server+request', () => withTimeout(new Promise((res, rej) => {
  const srv = http.createServer((q, s) => { s.end('httpok'); });
  srv.on('error', rej);
  srv.listen(0, '127.0.0.1', () => {
    http.get({ host: '127.0.0.1', port: srv.address().port, path: '/' }, r => {
      let d = ''; r.on('data', c => d += c); r.on('end', () => { srv.close(); res(r.statusCode + ' ' + d); });
    }).on('error', rej);
  });
}), 15000, 'node-http'));
await ta('WebSocket client->Bun.serve', () => withTimeout((async () => {
  const srv = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch(req, s) { if (s.upgrade(req)) return; return new Response('no'); }, websocket: { message(ws, m) { ws.send('echo:' + m); ws.close(); } } });
  const ws = new WebSocket('ws://127.0.0.1:' + srv.port + '/');
  const got = await new Promise((res, rej) => { ws.onopen = () => ws.send('hi'); ws.onmessage = e => res(e.data); ws.onerror = () => rej(new Error('ws error')); });
  srv.stop(true);
  return got;
})(), 15000, 'ws'));
await ta('net.listen named pipe (default ns)', () => withTimeout(new Promise((res, rej) => {
  const p = '\\\\.\\pipe\\acbun-' + process.pid;
  const srv = net.createServer(s => s.end('pipepong'));
  srv.on('error', rej);
  srv.listen(p, () => {
    const c = net.connect(p, () => c.write('x'));
    let d = ''; c.on('data', x => d += x); c.on('error', rej);
    c.on('end', () => { srv.close(); res('got=' + d); });
  });
}), 15000, 'pipe-default'));
await ta('net.listen named pipe (LOCAL ns)', () => withTimeout(new Promise((res, rej) => {
  const p = '\\\\.\\pipe\\LOCAL\\acbun-' + process.pid;
  const srv = net.createServer(s => s.end('pipepong'));
  srv.on('error', rej);
  srv.listen(p, () => {
    const c = net.connect(p, () => c.write('x'));
    let d = ''; c.on('data', x => d += x); c.on('error', rej);
    c.on('end', () => { srv.close(); res('got=' + d); });
  });
}), 15000, 'pipe-LOCAL'));
await ta('Bun.listen unix(named pipe LOCAL)', () => withTimeout((async () => {
  let resolve, got = new Promise(r => resolve = r);
  const p = '\\\\.\\pipe\\LOCAL\\acbun2-' + process.pid;
  const srv = Bun.listen({ unix: p, socket: { data(s, d) { s.write('upong'); s.flush(); } } });
  const c = await Bun.connect({ unix: p, socket: { data(s, d) { resolve(d.toString()); } } });
  c.write('ping'); c.flush();
  const g = await got; c.end(); srv.stop(true);
  return g;
})(), 15000, 'bun-unix-pipe'));
done('P_NET');
