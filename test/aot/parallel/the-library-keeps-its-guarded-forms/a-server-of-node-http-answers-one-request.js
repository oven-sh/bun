// The library asks `$isPlainInstanceOf` and `$isPlainHeirOf` of its own classes at every request. Each is answered by a look at the cell behind guards; one that is left as written goes the full road.
// STATISTIC: PlainInstanceChecksLeftGeneric <= 0
// STATISTIC: PreparedSymbolsAccessedByValue <= 0
// Under: --aot-allow-code-from-disk: where code from disk is admitted nothing is proven of a variable that a file of the library takes out of the require() of another: a question that names its class or its maker through one is left as written there alone.
import http from "node:http";
const server = http.createServer((request, response) => { response.writeHead(200, { "content-type": "text/plain" }); response.end("hello"); });
server.listen(0, () => { const { port } = server.address(); http.get({ port, path: "/" }, answer => { let text = ""; answer.on("data", part => { text += part; }); answer.on("end", () => { console.log(answer.statusCode, text); server.close(); }); }); });
