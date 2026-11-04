// The table of built-ins says of these functions what they answer and nothing else. The writer of a stream: a class of which the table lists no member.
function make() { return new WritableStream({ write(chunk) { console.log("wrote", chunk); } }).getWriter(); }
function kinds() { const w = make(); return [typeof w.write, typeof w.close, typeof w.abort, typeof w.releaseLock, typeof w.closed, typeof w.ready, typeof w.desiredSize, w.constructor.name, Object.prototype.toString.call(w)].join(); }
console.log(kinds());
const writer = make(); await writer.write("a"); await writer.close(); console.log(await writer.closed, writer instanceof WritableStreamDefaultWriter);
