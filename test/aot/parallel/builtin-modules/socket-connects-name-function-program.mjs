// A socket is connected to a host by a name, with and without a family and hints. A function of the program looks the name up and prints the options that it is handed.
// Flags: --aot-validate
import dns from "node:dns";
import net from "node:net";

const server = net.createServer(socket => socket.end("served"));
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();

function connect(given) {
  return new Promise(resolve => {
    const socket = net.connect({
      host: "a-name-that-only-the-program-knows",
      port,
      ...given,
      lookup(host, options, callback) {
        const hints = options.hints === dns.ADDRCONFIG ? "ADDRCONFIG" : options.hints;
        console.log(host, Object.keys(options).join(), options.family, hints, options.all);
        if (options.all) callback(null, [{ address: "127.0.0.1", family: 4 }]);
        else callback(null, "127.0.0.1", 4);
      },
    });
    let text = "";
    socket.on("data", chunk => (text += chunk));
    socket.on("close", () => resolve(text));
  });
}

console.log(await connect({}));
console.log(await connect({ family: 4 }));
console.log(await connect({ family: 0, hints: dns.V4MAPPED }));
console.log(await connect({ family: "IPv4", hints: 0 }));
console.log(await connect({ autoSelectFamily: false }));
server.close();
