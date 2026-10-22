const sink = new Bun.ArrayBufferSink();
console.log(sink.start({ asUint8Array: true }) === undefined);
console.log(sink.write("ab") + 1, sink.write(new Uint8Array([99])) + 1);
const bytes = sink.end();
console.log(bytes instanceof Uint8Array, bytes.length + 1, bytes[2] + 1);
