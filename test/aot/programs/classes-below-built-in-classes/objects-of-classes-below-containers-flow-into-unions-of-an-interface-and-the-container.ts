interface Stream {
  listeners: number;
  name?: string;
}
class Waiting extends Set<Stream> {
  listeners = 7;
  label = "waiting";
}
class Row extends Array<Stream> {
  listeners = 8;
}
class Table extends Map<string, Stream> {
  listeners = 9;
}
class Later extends Promise<Stream> {
  listeners = 10;
}
class Bytes extends Uint8Array {
  listeners = 11;
}
interface State {
  set: Stream | Set<Stream> | null;
  list: Stream | Stream[] | null;
  map: Stream | Map<string, Stream> | null;
  promise: Stream | Promise<Stream> | null;
  bytes: Stream | Uint8Array | null;
}

function countOf(stream: Stream): number {
  return stream.listeners;
}
function describe(value: State[keyof State]): string {
  if (value === null) return "null";
  if (value instanceof Set) {
    return "set " + value.size + " " + (value as Waiting).label + " " + (value as unknown as Stream).listeners;
  }
  if (Array.isArray(value)) return "list " + value.length + " " + (value as unknown as Stream).listeners;
  if (value instanceof Map) return "map " + value.size + " " + (value as unknown as Stream).listeners;
  if (value instanceof Promise) return "promise " + (value as unknown as Stream).listeners;
  if (value instanceof Uint8Array) return "bytes " + value.length + " " + (value as unknown as Stream).listeners;
  return "stream " + countOf(value);
}

const plain: Stream = { listeners: 1 };
const state: State = { set: null, list: null, map: null, promise: null, bytes: null };
function fill(turn: number) {
  state.set = turn % 3 === 0 ? plain : turn % 3 === 1 ? new Waiting([plain]) : new Set([plain, { listeners: 2 }]);
  state.list = turn % 3 === 0 ? plain : turn % 3 === 1 ? Row.from([plain, plain]) : [plain];
  state.map = turn % 3 === 0 ? plain : turn % 3 === 1 ? new Table([["a", plain]]) : new Map();
  state.promise = turn % 3 === 0 ? plain : turn % 3 === 1 ? Later.resolve(plain) : Promise.resolve(plain);
  state.bytes = turn % 3 === 0 ? plain : turn % 3 === 1 ? new Bytes(3) : new Uint8Array(4);
}
for (let turn = 0; turn < 6; turn++) {
  fill(turn);
  console.log(describe(state.set), "|", describe(state.list), "|", describe(state.map));
  console.log(describe(state.promise), "|", describe(state.bytes));
}
// Each of them has the member that a Stream requires, so the checker lets it in as one.
const streams = [new Waiting(), new Row(), new Table(), Later.resolve(plain), new Bytes(1), plain] as Stream[];
for (const stream of streams) console.log(countOf(stream));
