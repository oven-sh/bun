// A getter of a host class that may be redefined is read many times, then replaced on its prototype, deleted, inherited from an object put behind, and put back: each read answers as plain Bun does. A locked prototype leaves the attributes of its members as they are and stays extensible, so nothing tells the prototypes of URL, URLSearchParams, Request and Response apart beforehand: each change of their getters is refused, and every read goes on answering. The getters of TextDecoder, Request and Response here keep their answer in a field of the instance, which a read may take only while the getter stands. A third answer is that of a prototype which is not locked and whose getter the build has taken for what the host defines, as `fatal` of TextDecoder and `subtle` of Crypto: a change that the build cannot read is refused, and the message says so.
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
const encodingOf = (decoder: TextDecoder): unknown => decoder.encoding;
const urlOf = (request: Request): unknown => request.url;
const statusTextOf = (response: Response): unknown => response.statusText;
const fatalOf = (decoder: TextDecoder): unknown => decoder.fatal;
const subtleOf = (holder: Crypto): unknown => holder.subtle;
const untyped = (holder: any, name: "pathname" | "size" | "aborted" | "address" | "port" | "encoding" | "url" | "statusText" | "fatal" | "subtle"): unknown => {
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
    case "encoding":
      return holder.encoding;
    case "url":
      return holder.url;
    case "statusText":
      return holder.statusText;
    case "fatal":
      return holder.fatal;
    case "subtle":
      return holder.subtle;
  }
};

function all<T extends object>(label: string, name: "pathname" | "size" | "aborted" | "address" | "port" | "encoding" | "url" | "statusText" | "fatal" | "subtle", make: () => T, read: (holder: T) => unknown) {
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
all("TextDecoder.encoding", "encoding", () => new TextDecoder("utf-16le"), encodingOf);
all("Request.url", "url", () => new Request("http://example.com/r"), urlOf);
all("Response.statusText", "statusText", () => new Response(null, { statusText: "made" }), statusTextOf);
all("TextDecoder.fatal", "fatal", () => new TextDecoder("utf-8", { fatal: true }), fatalOf);
all("Crypto.subtle", "subtle", () => crypto, subtleOf);
console.log(lines.join("\n"));
/* Output:
URL.pathname has a descriptor that may be redefined: [true,"function"]
URL.pathname read many times: ["[\"/a/b\",\"/a/b\"]",200]
URL.pathname replaced by a getter: throws TypeError: Cannot assign to URL.prototype.pathname because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname replaced by another getter: throws TypeError: Cannot assign to URL.prototype.pathname because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname replaced by a value: throws TypeError: Cannot assign to URL.prototype.pathname because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname whose value is stored to: throws TypeError: Cannot assign to URL.prototype.pathname because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname put back: [["/a/b","/a/b"],["/a/b","/a/b"]]
URL.pathname deleted: throws TypeError: Cannot delete URL.prototype.pathname because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname inherited from an object put behind: throws TypeError: Cannot change the prototype of URL.prototype because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URL.pathname put back in front of it: [["/a/b","/a/b"],["/a/b","/a/b"]]
URL.pathname with the chain as it was: [["/a/b","/a/b"],["/a/b","/a/b"]]
URL.pathname behind an own property: [["own","own"],["/a/b","/a/b"]]
URL.pathname without the own property: [true,["/a/b","/a/b"],["/a/b","/a/b"]]
URLSearchParams.size has a descriptor that may be redefined: [true,"function"]
URLSearchParams.size read many times: ["[2,2]",200]
URLSearchParams.size replaced by a getter: throws TypeError: Cannot assign to URLSearchParams.prototype.size because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size replaced by another getter: throws TypeError: Cannot assign to URLSearchParams.prototype.size because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size replaced by a value: throws TypeError: Cannot assign to URLSearchParams.prototype.size because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size whose value is stored to: throws TypeError: Cannot assign to URLSearchParams.prototype.size because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size put back: [[2,2],[2,2]]
URLSearchParams.size deleted: throws TypeError: Cannot delete URLSearchParams.prototype.size because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size inherited from an object put behind: throws TypeError: Cannot change the prototype of URLSearchParams.prototype because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
URLSearchParams.size put back in front of it: [[2,2],[2,2]]
URLSearchParams.size with the chain as it was: [[2,2],[2,2]]
URLSearchParams.size behind an own property: [["own","own"],[2,2]]
URLSearchParams.size without the own property: [true,[2,2],[2,2]]
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
TextDecoder.encoding has a descriptor that may be redefined: [true,"function"]
TextDecoder.encoding read many times: ["[\"utf-16le\",\"utf-16le\"]",200]
TextDecoder.encoding replaced by a getter: [["replaced","replaced"],["replaced","replaced"]]
TextDecoder.encoding replaced by another getter: [["replaced again","replaced again"],["replaced again","replaced again"]]
TextDecoder.encoding replaced by a value: [[7,7],[7,7]]
TextDecoder.encoding whose value is stored to: [[8,8],[8,8]]
TextDecoder.encoding put back: [["utf-16le","utf-16le"],["utf-16le","utf-16le"]]
TextDecoder.encoding deleted: [true,[null,null],[null,null]]
TextDecoder.encoding inherited from an object put behind: [["from behind","from behind"],["from behind","from behind"]]
TextDecoder.encoding put back in front of it: [["utf-16le","utf-16le"],["utf-16le","utf-16le"]]
TextDecoder.encoding with the chain as it was: [["utf-16le","utf-16le"],["utf-16le","utf-16le"]]
TextDecoder.encoding behind an own property: [["own","own"],["utf-16le","utf-16le"]]
TextDecoder.encoding without the own property: [true,["utf-16le","utf-16le"],["utf-16le","utf-16le"]]
Request.url has a descriptor that may be redefined: [true,"function"]
Request.url read many times: ["[\"http://example.com/r\",\"http://example.com/r\"]",200]
Request.url replaced by a getter: throws TypeError: Cannot assign to Request.prototype.url because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url replaced by another getter: throws TypeError: Cannot assign to Request.prototype.url because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url replaced by a value: throws TypeError: Cannot assign to Request.prototype.url because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url whose value is stored to: throws TypeError: Cannot assign to Request.prototype.url because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url put back: [["http://example.com/r","http://example.com/r"],["http://example.com/r","http://example.com/r"]]
Request.url deleted: throws TypeError: Cannot delete Request.prototype.url because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url inherited from an object put behind: throws TypeError: Cannot change the prototype of Request.prototype because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Request.url put back in front of it: [["http://example.com/r","http://example.com/r"],["http://example.com/r","http://example.com/r"]]
Request.url with the chain as it was: [["http://example.com/r","http://example.com/r"],["http://example.com/r","http://example.com/r"]]
Request.url behind an own property: [["own","own"],["http://example.com/r","http://example.com/r"]]
Request.url without the own property: [true,["http://example.com/r","http://example.com/r"],["http://example.com/r","http://example.com/r"]]
Response.statusText has a descriptor that may be redefined: [true,"function"]
Response.statusText read many times: ["[\"made\",\"made\"]",200]
Response.statusText replaced by a getter: throws TypeError: Cannot assign to Response.prototype.statusText because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText replaced by another getter: throws TypeError: Cannot assign to Response.prototype.statusText because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText replaced by a value: throws TypeError: Cannot assign to Response.prototype.statusText because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText whose value is stored to: throws TypeError: Cannot assign to Response.prototype.statusText because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText put back: [["made","made"],["made","made"]]
Response.statusText deleted: throws TypeError: Cannot delete Response.prototype.statusText because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText inherited from an object put behind: throws TypeError: Cannot change the prototype of Response.prototype because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Response.statusText put back in front of it: [["made","made"],["made","made"]]
Response.statusText with the chain as it was: [["made","made"],["made","made"]]
Response.statusText behind an own property: [["own","own"],["made","made"]]
Response.statusText without the own property: [true,["made","made"],["made","made"]]
TextDecoder.fatal has a descriptor that may be redefined: [true,"function"]
TextDecoder.fatal read many times: ["[true,true]",200]
TextDecoder.fatal replaced by a getter: throws TypeError: Cannot assign to TextDecoder.prototype.fatal because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in TextDecoder.prototype.fatal = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
TextDecoder.fatal replaced by another getter: throws TypeError: Cannot assign to TextDecoder.prototype.fatal because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in TextDecoder.prototype.fatal = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
TextDecoder.fatal replaced by a value: throws TypeError: Cannot assign to TextDecoder.prototype.fatal because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in TextDecoder.prototype.fatal = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
TextDecoder.fatal whose value is stored to: throws TypeError: Cannot assign to TextDecoder.prototype.fatal because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in TextDecoder.prototype.fatal = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
TextDecoder.fatal put back: [[true,true],[true,true]]
TextDecoder.fatal deleted: throws TypeError: Cannot delete TextDecoder.prototype.fatal because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
TextDecoder.fatal inherited from an object put behind: [[true,true],[true,true]]
TextDecoder.fatal put back in front of it: [[true,true],[true,true]]
TextDecoder.fatal with the chain as it was: [[true,true],[true,true]]
TextDecoder.fatal behind an own property: [["own","own"],[true,true]]
TextDecoder.fatal without the own property: [true,[true,true],[true,true]]
Crypto.subtle has a descriptor that may be redefined: [true,"function"]
Crypto.subtle read many times: ["[{},{}]",200]
Crypto.subtle replaced by a getter: throws TypeError: Cannot assign to Crypto.prototype.subtle because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Crypto.prototype.subtle = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Crypto.subtle replaced by another getter: throws TypeError: Cannot assign to Crypto.prototype.subtle because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Crypto.prototype.subtle = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Crypto.subtle replaced by a value: throws TypeError: Cannot assign to Crypto.prototype.subtle because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Crypto.prototype.subtle = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Crypto.subtle whose value is stored to: throws TypeError: Cannot assign to Crypto.prototype.subtle because built-in objects are read-only in a compiled executable, and the build didn't see your code assign to this one. Spell out the object and the name where it does, as in Crypto.prototype.subtle = value (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Crypto.subtle put back: [[{},{}],[{},{}]]
Crypto.subtle deleted: throws TypeError: Cannot delete Crypto.prototype.subtle because built-in objects are read-only in a compiled executable (bun compile differs from bun run here: https://bun.com/docs/compiler/compatibility)
Crypto.subtle inherited from an object put behind: [[{},{}],[{},{}]]
Crypto.subtle put back in front of it: [[{},{}],[{},{}]]
Crypto.subtle with the chain as it was: [[{},{}],[{},{}]]
Crypto.subtle behind an own property: [["own","own"],["own","own"]]
Crypto.subtle without the own property: [true,[{},{}],[{},{}]]
*/
