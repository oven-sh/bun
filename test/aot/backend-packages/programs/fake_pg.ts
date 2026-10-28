import net from "node:net";

const empty = Buffer.alloc(0);
const cstring = (text: string): Buffer => Buffer.concat([Buffer.from(text, "utf8"), Buffer.from([0])]);
const int16 = (n: number): Buffer => { const b = Buffer.alloc(2); b.writeInt16BE(n); return b; };
const int32 = (n: number): Buffer => { const b = Buffer.alloc(4); b.writeInt32BE(n); return b; };
function message(type: string, payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from(type, "latin1"), int32(payload.length + 4), payload]);
}

type Row = [number, string];
const rows: Row[] = [[1, "ada"], [2, "grace"]];

function rowDescription(): Buffer {
  const field = (name: string, oid: number, size: number): Buffer =>
    Buffer.concat([cstring(name), int32(0), int16(0), int32(oid), int16(size), int32(-1), int16(0)]);
  return message("T", Buffer.concat([int16(2), field("id", 23, 4), field("name", 25, -1)]));
}
function dataRow(row: Row): Buffer {
  const cells = row.map(value => { const b = Buffer.from(String(value)); return Buffer.concat([int32(b.length), b]); });
  return message("D", Buffer.concat([int16(cells.length), ...cells]));
}
const ready = (): Buffer => message("Z", Buffer.from("I"));

export function fakePostgres(seen: string[]): net.Server {
  return net.createServer(socket => {
    let pending: Buffer = empty;
    let started = false;
    socket.on("error", () => {});
    socket.on("data", (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      for (;;) {
        if (!started) {
          if (pending.length < 8) return;
          const length = pending.readInt32BE(0);
          if (pending.length < length) return;
          const code = pending.readInt32BE(4);
          pending = pending.subarray(length);
          if (code === 80877103) { socket.write("N"); continue; }
          started = true;
          socket.write(Buffer.concat([
            message("R", int32(0)),
            message("S", Buffer.concat([cstring("server_version"), cstring("16.0")])),
            message("S", Buffer.concat([cstring("client_encoding"), cstring("UTF8")])),
            message("K", Buffer.concat([int32(1), int32(2)])),
            ready(),
          ]));
          continue;
        }
        if (pending.length < 5) return;
        const type = String.fromCharCode(pending[0]!);
        const length = pending.readInt32BE(1);
        if (pending.length < length + 1) return;
        const payload = pending.subarray(5, length + 1);
        pending = pending.subarray(length + 1);
        switch (type) {
          case "Q":
            seen.push("simple: " + payload.toString("utf8", 0, payload.length - 1));
            socket.write(Buffer.concat([rowDescription(), ...rows.map(dataRow), message("C", cstring("SELECT 2")), ready()]));
            break;
          case "P": {
            const nameEnd = payload.indexOf(0);
            seen.push("parse: " + payload.toString("utf8", nameEnd + 1, payload.indexOf(0, nameEnd + 1)));
            socket.write(message("1", empty));
            break;
          }
          case "B": socket.write(message("2", empty)); break;
          case "D": socket.write(rowDescription()); break;
          case "E": socket.write(Buffer.concat([...rows.map(dataRow), message("C", cstring("SELECT 2"))])); break;
          case "S": socket.write(ready()); break;
          case "X": socket.end(); return;
        }
      }
    });
  });
}
