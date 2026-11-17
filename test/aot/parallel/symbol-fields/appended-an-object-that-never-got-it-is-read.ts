// A symbol that no layout lists names a field that the compiler appends. ONE DEED: no store at all
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
const bare = new Socket();
console.log(show(bare), kRequest in bare, Object.hasOwn(bare, kRequest), Object.hasOwn(made, kRequest));
