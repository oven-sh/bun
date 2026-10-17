import net from "node:net";
import { deserialize, Long, serialize, type Document } from "bson";

export function fakeMongo(seen: string[]): net.Server {
  const stored: Document[] = [];
  let nextId = 1;
  const hello = (): Document => ({
    helloOk: true, ismaster: true, isWritablePrimary: true, maxBsonObjectSize: 16777216, maxMessageSizeBytes: 48000000,
    maxWriteBatchSize: 100000, localTime: new Date(0), logicalSessionTimeoutMinutes: 30, connectionId: 1, minWireVersion: 0,
    maxWireVersion: 25, readOnly: false, ok: 1,
  });
  const matches = (document: Document, filter: Document): boolean => Object.entries(filter).every(([k, v]) => document[k] === v);
  const cursor = (command: Document, name: string, batch: Document[]): Document =>
    ({ cursor: { id: Long.ZERO, ns: command.$db + "." + command[name], firstBatch: batch }, ok: 1 });
  const answer = (command: Document): Document => {
    const name = Object.keys(command)[0]!;
    switch (name) {
      case "hello": case "ismaster": case "isMaster": return hello();
      case "insert": seen.push("insert " + command.documents.length); stored.push(...command.documents); return { n: command.documents.length, ok: 1 };
      case "find": seen.push("find " + JSON.stringify(command.filter ?? {})); return cursor(command, name, stored.filter(d => matches(d, command.filter ?? {})).slice(0, command.limit || undefined));
      case "aggregate": seen.push("aggregate"); return cursor(command, name, [{ n: stored.length }]);
      case "update": seen.push("update"); return { n: 1, nModified: 1, ok: 1 };
      case "delete": seen.push("delete"); return { n: 1, ok: 1 };
      default: return { ok: 1 };
    }
  };
  return net.createServer(socket => {
    let pending: Buffer = Buffer.alloc(0);
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 16 && pending.length >= pending.readInt32LE(0)) {
        const length = pending.readInt32LE(0);
        const frame = pending.subarray(0, length);
        pending = pending.subarray(length);
        const requestId = frame.readInt32LE(4);
        const opCode = frame.readInt32LE(12);
        const header = (size: number, code: number): Buffer => {
          const b = Buffer.alloc(16);
          b.writeInt32LE(size + 16, 0); b.writeInt32LE(nextId++, 4); b.writeInt32LE(requestId, 8); b.writeInt32LE(code, 12);
          return b;
        };
        if (opCode === 2013) {
          let command: Document = {};
          const sequences: Record<string, Document[]> = {};
          for (let at = 20; at < frame.length; ) {
            const kind = frame[at++];
            if (kind === 0) { const size = frame.readInt32LE(at); command = deserialize(frame.subarray(at, at + size)); at += size; }
            else {
              const end = at + frame.readInt32LE(at);
              const nameEnd = frame.indexOf(0, at + 4);
              const documents: Document[] = (sequences[frame.toString("utf8", at + 4, nameEnd)] = []);
              for (at = nameEnd + 1; at < end; ) { const size = frame.readInt32LE(at); documents.push(deserialize(frame.subarray(at, at + size))); at += size; }
            }
          }
          const reply = Buffer.from(serialize(answer({ ...command, ...sequences })));
          socket.write(Buffer.concat([header(5 + reply.length, 2013), Buffer.from([0, 0, 0, 0, 0]), reply]));
        } else if (opCode === 2004) {
          const at = frame.indexOf(0, 20) + 1 + 8;
          const reply = Buffer.from(serialize(answer(deserialize(frame.subarray(at, at + frame.readInt32LE(at))))));
          const fixed = Buffer.alloc(20);
          fixed.writeInt32LE(8, 0); fixed.writeInt32LE(1, 16);
          socket.write(Buffer.concat([header(20 + reply.length, 1), fixed, reply]));
        }
      }
    });
  });
}
