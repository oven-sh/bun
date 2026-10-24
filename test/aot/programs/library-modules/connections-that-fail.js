// What comes back when nobody answers: tls.connect, https.get, http.get, net.connect and fetch to a port that was just closed; a host name that cannot exist; and a look-up of localhost in every form node:dns has.
import tls from "node:tls";
import https from "node:https";
import http from "node:http";
import net from "node:net";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";

const probe = net.createServer();
await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
const { port } = probe.address();
await new Promise(resolve => probe.close(resolve));

const failure = emitter => new Promise(resolve => emitter.on("error", error => resolve(error.code)));
console.log("tls", await failure(tls.connect({ port, host: "127.0.0.1" })));
console.log("https", await failure(https.get({ port, host: "127.0.0.1" })));
console.log("http", await failure(http.get({ port, host: "127.0.0.1" })));
console.log("net", await failure(net.connect(port, "127.0.0.1")));
console.log("fetch", await fetch("http://127.0.0.1:" + port).catch(error => error.code));

const local = ["127.0.0.1", "::1"];
console.log(await new Promise(resolve => dns.lookup("localhost", (error, address, family) => resolve([error, local.includes(address), [4, 6].includes(family)].join()))));
console.log(await new Promise(resolve => dns.lookup("localhost", { family: 4 }, (error, address, family) => resolve([address, family].join()))));
console.log(await new Promise(resolve => dns.lookup("localhost", { all: true }, (error, list) => resolve(list.length > 0 && list.every(entry => local.includes(entry.address))))));
console.log(JSON.stringify(await dnsPromises.lookup("127.0.0.1")), local.includes((await dns.promises.lookup("localhost")).address), dns.promises === dnsPromises);
console.log(await dnsPromises.lookup("no-such-host.invalid").catch(error => [error.code, error.syscall, error.hostname].join()));
console.log(await new Promise(resolve => dns.lookupService("127.0.0.1", 80, (error, hostname, service) => resolve([typeof hostname, service].join()))));
console.log(Array.isArray(dns.getServers()), typeof dns.Resolver, dns.NOTFOUND, typeof dns.setDefaultResultOrder, typeof tls.createSecureContext, tls.DEFAULT_MIN_VERSION, Array.isArray(tls.rootCertificates), tls.getCiphers().length > 0);
