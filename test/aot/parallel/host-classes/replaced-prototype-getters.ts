// A getter of a host class that may be redefined is read many times, then replaced on its prototype, deleted, inherited from an object put behind, and put back: each read answers as plain Bun does. A locked prototype leaves the attributes of its members as they are and is not extensible: that tells URL.prototype and URLSearchParams.prototype apart, whose getters are only read.
// Alone: what it prints depends on what else the executable holds: which modules and members were compiled in, and whether anything evaluates text
import { SocketAddress } from "node:net";

const lines: string[] = [];
function say(label: string, work: () => unknown) {
  let text: string;
  try {
    text = JSON.stringify(work()) ?? "undefined";
  } catch (error) {
    text = "throws " + (error as Error).constructor.name + ": " + (error as Error).message;
  }
  lines.push(label + ": " + text);
}

const pathnameOf = (url: URL): unknown => url.pathname;
const sizeOf = (params: URLSearchParams): unknown => params.size;
const abortedOf = (signal: AbortSignal): unknown => signal.aborted;
const addressOf = (address: SocketAddress): unknown => address.address;
const portOf = (address: SocketAddress): unknown => address.port;
const untyped = (holder: any, name: "pathname" | "size" | "aborted" | "address" | "port"): unknown => {
  switch (name) {
    case "pathname":
      return holder.pathname;
    case "size":
      return holder.size;
    case "aborted":
      return holder.aborted;
    case "address":
      return holder.address;
    case "port":
      return holder.port;
  }
};

function all<T extends object>(label: string, name: "pathname" | "size" | "aborted" | "address" | "port", make: () => T, read: (holder: T) => unknown) {
  const holder = make();
  const prototype = Object.getPrototypeOf(holder) as object;
  const original = Object.getOwnPropertyDescriptor(prototype, name);
  const both = (on: T = holder) => [read(on), untyped(on, name)];
  const mayBeRedefined = !!original?.configurable && Object.isExtensible(prototype);
  say(label + " has a descriptor that may be redefined", () => [mayBeRedefined, typeof original?.get]);
  say(label + " read many times", () => {
    let same = 0;
    const first = JSON.stringify(both());
    for (let turn = 0; turn < 200; turn++) if (JSON.stringify(both()) === first) same++;
    return [first, same];
  });
  if (!mayBeRedefined) return;
  say(label + " replaced by a getter", () => (Object.defineProperty(prototype, name, { get: () => "replaced", configurable: true }), [both(), both(make())]));
  say(label + " replaced by another getter", () => (Object.defineProperty(prototype, name, { get: () => "replaced again", configurable: true }), [both(), both(make())]));
  say(label + " replaced by a value", () => (Object.defineProperty(prototype, name, { value: 7, writable: true, configurable: true }), [both(), both(make())]));
  say(label + " whose value is stored to", () => (((prototype as Record<string, unknown>)[name] = 8), [both(), both(make())]));
  say(label + " put back", () => (Object.defineProperty(prototype, name, original), [both(), both(make())]));
  say(label + " deleted", () => [delete (prototype as Record<string, unknown>)[name], both(), both(make())]);
  const behind = Object.getPrototypeOf(prototype) as object;
  say(label + " inherited from an object put behind", () => (Object.setPrototypeOf(prototype, Object.create(behind, { [name]: { value: "from behind", configurable: true } })), [both(), both(make())]));
  say(label + " put back in front of it", () => (Object.defineProperty(prototype, name, original), [both(), both(make())]));
  say(label + " with the chain as it was", () => (Object.setPrototypeOf(prototype, behind), [both(), both(make())]));
  say(label + " behind an own property", () => (Object.defineProperty(holder, name, { value: "own", configurable: true }), [both(), both(make())]));
  say(label + " without the own property", () => [delete (holder as Record<string, unknown>)[name], both(), both(make())]);
}

all("URL.pathname", "pathname", () => new URL("http://example.com/a/b?c=d"), pathnameOf);
all("URLSearchParams.size", "size", () => new URLSearchParams("a=1&b=2"), sizeOf);
all("AbortSignal.aborted", "aborted", () => AbortSignal.abort(), abortedOf);
all("SocketAddress.address", "address", () => new SocketAddress({ address: "127.0.0.1", port: 80 }), addressOf);
all("SocketAddress.port", "port", () => new SocketAddress({ address: "127.0.0.1", port: 80 }), portOf);
console.log(lines.join("\n"));
/* Output:
URL.pathname has a descriptor that may be redefined: [false,"function"]
URL.pathname read many times: ["[\"/a/b\",\"/a/b\"]",200]
URLSearchParams.size has a descriptor that may be redefined: [false,"function"]
URLSearchParams.size read many times: ["[2,2]",200]
AbortSignal.aborted has a descriptor that may be redefined: [true,"function"]
AbortSignal.aborted read many times: ["[true,true]",200]
AbortSignal.aborted replaced by a getter: [["replaced","replaced"],["replaced","replaced"]]
AbortSignal.aborted replaced by another getter: [["replaced again","replaced again"],["replaced again","replaced again"]]
AbortSignal.aborted replaced by a value: [[7,7],[7,7]]
AbortSignal.aborted whose value is stored to: [[8,8],[8,8]]
AbortSignal.aborted put back: [[true,true],[true,true]]
AbortSignal.aborted deleted: [true,[null,null],[null,null]]
AbortSignal.aborted inherited from an object put behind: [["from behind","from behind"],["from behind","from behind"]]
AbortSignal.aborted put back in front of it: [[true,true],[true,true]]
AbortSignal.aborted with the chain as it was: [[true,true],[true,true]]
AbortSignal.aborted behind an own property: [["own","own"],[true,true]]
AbortSignal.aborted without the own property: [true,[true,true],[true,true]]
SocketAddress.address has a descriptor that may be redefined: [true,"function"]
SocketAddress.address read many times: ["[\"127.0.0.1\",\"127.0.0.1\"]",200]
SocketAddress.address replaced by a getter: [["replaced","replaced"],["replaced","replaced"]]
SocketAddress.address replaced by another getter: [["replaced again","replaced again"],["replaced again","replaced again"]]
SocketAddress.address replaced by a value: [[7,7],[7,7]]
SocketAddress.address whose value is stored to: [[8,8],[8,8]]
SocketAddress.address put back: [["127.0.0.1","127.0.0.1"],["127.0.0.1","127.0.0.1"]]
SocketAddress.address deleted: [true,[null,null],[null,null]]
SocketAddress.address inherited from an object put behind: [["from behind","from behind"],["from behind","from behind"]]
SocketAddress.address put back in front of it: [["127.0.0.1","127.0.0.1"],["127.0.0.1","127.0.0.1"]]
SocketAddress.address with the chain as it was: [["127.0.0.1","127.0.0.1"],["127.0.0.1","127.0.0.1"]]
SocketAddress.address behind an own property: [["own","own"],["127.0.0.1","127.0.0.1"]]
SocketAddress.address without the own property: [true,["127.0.0.1","127.0.0.1"],["127.0.0.1","127.0.0.1"]]
SocketAddress.port has a descriptor that may be redefined: [true,"function"]
SocketAddress.port read many times: ["[80,80]",200]
SocketAddress.port replaced by a getter: [["replaced","replaced"],["replaced","replaced"]]
SocketAddress.port replaced by another getter: [["replaced again","replaced again"],["replaced again","replaced again"]]
SocketAddress.port replaced by a value: [[7,7],[7,7]]
SocketAddress.port whose value is stored to: [[8,8],[8,8]]
SocketAddress.port put back: [[80,80],[80,80]]
SocketAddress.port deleted: [true,[null,null],[null,null]]
SocketAddress.port inherited from an object put behind: [["from behind","from behind"],["from behind","from behind"]]
SocketAddress.port put back in front of it: [[80,80],[80,80]]
SocketAddress.port with the chain as it was: [[80,80],[80,80]]
SocketAddress.port behind an own property: [["own","own"],[80,80]]
SocketAddress.port without the own property: [true,[80,80],[80,80]]
*/
