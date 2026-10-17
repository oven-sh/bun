function message(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
function int16(value: number): Buffer {
  const bytes = Buffer.alloc(2);
  bytes.writeInt16BE(value);
  return bytes;
}
function int32(value: number): Buffer {
  const bytes = Buffer.alloc(4);
  bytes.writeInt32BE(value);
  return bytes;
}
const text = (value: string) => Buffer.concat([Buffer.from(value), Buffer.from([0])]);

const int4 = 23;
const columns = ["id", "randomnumber"];
const parametersOfStatement = new Map<string, number>();

interface Connection {
  pending: Buffer;
  hasStarted: boolean;
  isBinary: boolean;
}

function cell(value: number, isBinary: boolean): Buffer {
  const bytes = isBinary ? int32(value) : Buffer.from(String(value));
  return Buffer.concat([int32(bytes.length), bytes]);
}

function answer(type: string, body: Buffer, connection: Connection): Buffer {
  if (type === "P") {
    const endOfName = body.indexOf(0);
    const query = body.toString("utf8", endOfName + 1, body.indexOf(0, endOfName + 1));
    parametersOfStatement.set(body.toString("utf8", 0, endOfName), query.includes("$1") ? 1 : 0);
    return message("1");
  }
  if (type === "D") {
    const parameters = parametersOfStatement.get(body.toString("utf8", 1, body.indexOf(0, 1)))!;
    const described = columns.map(name => Buffer.concat([text(name), int32(0), int16(0), int32(int4), int16(4), int32(-1), int16(0)]));
    return Buffer.concat([
      message("t", int16(parameters), ...Array.from({ length: parameters }, () => int32(int4))),
      message("T", int16(columns.length), ...described),
    ]);
  }
  if (type === "B") {
    let at = body.indexOf(0, body.indexOf(0) + 1) + 1;
    at += 2 + 2 * body.readInt16BE(at);
    const parameters = body.readInt16BE(at);
    at += 2;
    for (let index = 0; index < parameters; index++) at += 4 + Math.max(0, body.readInt32BE(at));
    connection.isBinary = body.readInt16BE(at) > 0 && body.readInt16BE(at + 2) === 1;
    return message("2");
  }
  if (type === "E")
    return Buffer.concat([
      message("D", int16(2), cell(7, connection.isBinary), cell(4242, connection.isBinary)),
      message("C", text("SELECT 1")),
    ]);
  return type === "S" ? message("Z", Buffer.from("I")) : Buffer.alloc(0);
}

export function serve(): void {
  let openConnections = 0;
  const server = Bun.listen<Connection>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open(socket) {
        openConnections++;
        socket.data = { pending: Buffer.alloc(0), hasStarted: false, isBinary: false };
      },
      close() {
        if (--openConnections === 0) process.exit(0);
      },
      data(socket, received) {
        const connection = socket.data;
        connection.pending = Buffer.concat([connection.pending, received]);
        const answers: Buffer[] = [];
        if (!connection.hasStarted) {
          if (connection.pending.length < 4 || connection.pending.length < connection.pending.readInt32BE(0)) return;
          connection.pending = connection.pending.subarray(connection.pending.readInt32BE(0));
          connection.hasStarted = true;
          answers.push(message("R", int32(0)), message("Z", Buffer.from("I")));
        }
        while (connection.pending.length >= 5 && connection.pending.length >= 1 + connection.pending.readInt32BE(1)) {
          const end = 1 + connection.pending.readInt32BE(1);
          answers.push(answer(String.fromCharCode(connection.pending[0]!), connection.pending.subarray(5, end), connection));
          connection.pending = connection.pending.subarray(end);
        }
        socket.write(Buffer.concat(answers));
      },
    },
  });
  console.log(String(server.port));
}
