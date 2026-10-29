// Objects of several host classes are printed.
import zlib from "node:zlib";
import net from "node:net";
import { X509Certificate } from "node:crypto";
const shown = [
  zlib.createGzip(),
  new net.BlockList(),
  new net.SocketAddress({ address: "127.0.0.1", port: 80 }),
  setTimeout(() => {}, 0),
  setImmediate(() => {}),
];
for (const value of shown)
  console.log(
    typeof value,
    Object.prototype.toString.call(value),
    typeof value[Symbol.for("nodejs.util.inspect.custom")],
    String(Bun.inspect(value)).length > 0,
  );
console.log(typeof X509Certificate, shown[2].address, shown[1].check("1.1.1.1"));
clearTimeout(shown[3]);
clearImmediate(shown[4]);
