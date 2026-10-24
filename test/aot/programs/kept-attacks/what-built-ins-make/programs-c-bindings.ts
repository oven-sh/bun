// What built ins make: programs c bindings. It prints what plain Bun prints.
import util from "node:util";
import url from "node:url";
import tls from "node:tls";
import net from "node:net";
import http from "node:http";
const mime = new util.MIMEType("text/plain; charset=utf-8");
console.log(String(mime), mime.type, mime.subtype, mime.params.get("charset"), mime.params instanceof util.MIMEParams, typeof util.MIMEParams);
try { new util.MIMEType("nope"); } catch (e) { console.log((e as any).code, (e as Error).name, (e as Error).message); }
console.log(url.domainToASCII("español.com"), url.domainToUnicode("xn--espaol-zwa.com"), url.domainToASCII("xn--iñvalid.com"));
console.log(typeof tls.createSecureContext({}), tls.createSecureContext({}).constructor.name);
const list = new net.BlockList(); list.addAddress("1.2.3.4"); console.log(list.check("1.2.3.4"), list.check("1.2.3.5"), net.BlockList.isBlockList(list));
const address = new net.SocketAddress({ address: "127.0.0.1", port: 80 }); console.log(address.address, address.port, address.family);
const server = http.createServer({ maxHeaderSize: 4096, requireHostHeader: false }, (request, response) => response.end("ok " + request.url));
server.maxHeadersCount = 10;
server.listen(0, async () => {
  const { port } = server.address() as net.AddressInfo;
  console.log(await (await fetch(`http://127.0.0.1:${port}/x`)).text());
  server.close(() => console.log("closed"));
});
