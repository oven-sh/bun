// p_ext: external network (DNS, TCP, TLS, HTTP) - exercises internetClient capability.
import dns from 'node:dns';
import tls from 'node:tls';
import https from 'node:https';
import { ta, withTimeout, done } from './_h.mjs';

await ta('dns.promises.lookup', () => withTimeout(dns.promises.lookup('example.com').then(r => JSON.stringify(r)), 15000, 'lookup'));
await ta('dns.promises.resolve4', () => withTimeout(dns.promises.resolve4('example.com').then(r => JSON.stringify(r)), 15000, 'resolve4'));
await ta('dns.promises.resolveTxt', () => withTimeout(dns.promises.resolveTxt('example.com').then(r => JSON.stringify(r).slice(0, 60)), 15000, 'resolveTxt'));
await ta('Bun.dns.lookup', () => withTimeout(Bun.dns.lookup('example.com').then(r => JSON.stringify(r).slice(0, 80)), 15000, 'bundns'));
await ta('fetch https external', () => withTimeout(fetch('https://example.com/').then(async r => r.status + ' len=' + (await r.text()).length), 20000, 'fetch-ext'));
await ta('fetch http external', () => withTimeout(fetch('http://example.com/').then(async r => r.status + ' redirected=' + r.redirected), 20000, 'fetch-http'));
await ta('node:https.get', () => withTimeout(new Promise((res, rej) => { https.get('https://example.com/', r => { let n = 0; r.on('data', c => n += c.length); r.on('end', () => res(r.statusCode + ' len=' + n)); }).on('error', rej); }), 20000, 'https-get'));
await ta('tls.connect(example.com:443)', () => withTimeout(new Promise((res, rej) => {
  const s = tls.connect(443, 'example.com', { servername: 'example.com' }, () => { const c = s.getPeerCertificate(); s.end(); res('auth=' + s.authorized + ' cn=' + (c && c.subject && (c.subject.CN || c.subject.O))); });
  s.on('error', rej);
}), 20000, 'tls'));
await ta('fetch 127.0.0.1 closed-port', () => withTimeout(fetch('http://127.0.0.1:1/').then(r => 'unexpected ' + r.status, e => 'rejected: ' + (e && (e.code || e.name))), 15000, 'fetch-refused'));
done('P_EXT');
