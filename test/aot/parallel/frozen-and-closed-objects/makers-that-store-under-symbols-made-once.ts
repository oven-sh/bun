// A symbol that is made once is a constant key: `o[kHeaders] = ..` is walked as a store by name. Here such stores stand among stores by name on what `new` has just handed back.
const kHeaders = Symbol("headers"), kState = Symbol("state");
function Message(this: any, url: string) { this.url = url; this[kState] = 0; this.method = "GET"; this[kHeaders] = null; }
interface MessageObject { url: string; method: string; complete?: boolean; rawHeaders?: string[]; [kHeaders]?: object; [kState]?: number }
class Parser { [kState] = 0; }
interface Parser { incoming?: MessageObject; count?: number }
let message: any, parser: any;
function show(o: object): string { return Reflect.ownKeys(o).map(String).join() + "|" + JSON.stringify(o) + "|" + String((o as any)[kState]) + "|" + JSON.stringify((o as any)[kHeaders]); }
function make(url: string, n: number): MessageObject { const m: MessageObject = new message(url); m[kHeaders] = { n }; m.complete = false; m[kState] = n; m.rawHeaders = []; return m; }
function symbolsFirst(url: string, n: number): MessageObject { const m: MessageObject = new message(url); m[kState] = n; m[kHeaders] = undefined; m.complete = true; return m; }
function onlySymbols(n: number): Parser { const p: Parser = new parser(); p[kState] = n; return p; }
function mixed(n: number): Parser { const p: Parser = new parser(); p.count = n; p[kState] = n + 1; p.incoming = make("/", n); p[kState] = n + 2; return p; }
message = Message; parser = Parser;
for (let i = 0; i < 40; i++) { make("/a", i); symbolsFirst("/b", i); onlySymbols(i); mixed(i); }
console.log(show(make("/a", 1)), show(symbolsFirst("/b", 2)), show(onlySymbols(3)), show(mixed(4)));
Object.defineProperty(Message.prototype, kState, { set(v) { console.log("setter", v); }, configurable: true });
console.log(show(make("/a", 5)), show(symbolsFirst("/b", 6)));
