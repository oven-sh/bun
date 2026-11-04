// A symbol that no layout lists names a field that the compiler appends. ONE DEED: a proxy of the object
const kRequest = Symbol("request");
interface Tagged { [kRequest]: { n: number } | undefined; }
class Socket { id = 1; }
function attach(socket: Socket, request: { n: number }) { (socket as unknown as Tagged)[kRequest] = request; }
function requestOf(socket: Socket) { return (socket as unknown as Tagged)[kRequest]; }
function show(socket: Socket) { const found: any = requestOf(socket); return typeof found + ":" + (found && typeof found === "object" ? found.n : String(found)) + ":" + Reflect.ownKeys(socket).map(String).join(); }
function tell(deed: () => unknown) { try { console.log(String(deed())); } catch (error) { console.log((error as Error).name); } }
const made = new Socket();
attach(made, { n: 1 });
console.log(show(made));
const log: string[] = [];
const proxy = new Proxy(made, { set(target, key, value) { log.push("set " + String(key)); return Reflect.set(target, key, value); }, get(target, key) { log.push("get " + String(key)); return Reflect.get(target, key); } });
attach(proxy, { n: 12 });
console.log(typeof requestOf(proxy), log.join(), show(made));
