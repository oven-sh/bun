// Closures that are lent: left fast path. It prints what plain Bun prints.
const pick = new Function("list", "i", process.argv.length < 99 ? "return list[i]" : "") as <T>(list: T[], i: number) => T;
class Host { constructor(public name: string) {} }
class Store { n = 0; constructor(public host: Host) {} }
class Stores {
  map = new Map<Host, Store>();
  of(host: Host): Store { let s = this.map.get(host); if (!s) this.map.set(host, (s = new Store(host))); s.n++; return s; }
}
const stores: Stores = pick([new Stores()], 0);
type Session = { host: Host };
const sessions: Session[] = [{ host: new Host("a") }, { host: { name: "b" } }, { host: JSON.parse('{"name":"c","more":1}') }];
function root(i: number): Session { return pick(sessions, i % 3); }
function get(i: number): Store { return stores.of(root(i).host); }
let sum = 0;
for (let i = 0; i < 9000; i++) sum += get(i).n;
console.log(sum, stores.map.size);
