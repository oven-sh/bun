// node:net's Socket stands below constructor functions (Duplex, Readable, Stream, EventEmitter) whose prototype objects hold what no record declares, `destroy` among it, and lays a `destroy` of its own in front.
// When its guards are armed none of them ends for that, and no word of the method table is written: its pages stay read-only from the start of the process on.
// COUNT: counter:MethodTablePagesMadeWritable = 0
import { createServer } from "node:http";
const server = createServer((request, response) => { response.end("hello"); });
server.listen(0, () => { console.log("listening"); server.close(); });
