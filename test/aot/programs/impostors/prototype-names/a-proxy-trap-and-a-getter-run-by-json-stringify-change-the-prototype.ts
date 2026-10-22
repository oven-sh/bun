// Two built-ins run code of the program behind the compiler's back: a read through a Proxy runs its trap, and JSON.stringify runs a getter.
// Each of them puts a member named like an optional field on the prototype of a class, between two reads of that field in one function.
class Doc {
  declare id: number;
  declare version?: number;
  constructor(id: number) {
    this.id = id;
  }
}
class Page {
  declare id: number;
  declare version?: number;
  constructor(id: number) {
    this.id = id;
  }
}
const log: string[] = [];
let armed = false;
const settings: { verbose: boolean } = new Proxy(
  { verbose: false },
  {
    get(target, key, receiver) {
      if (armed) {
        armed = false;
        (Doc.prototype as any)[String(key).replace("verbose", "version")] = 77;
      }
      return Reflect.get(target, key, receiver);
    },
  },
);
const report = {
  title: "report",
  get pages() {
    if (armed) {
      armed = false;
      Object.defineProperty(Page.prototype, "version", {
        set(this: Page, value: number) {
          log.push(`set ${value} on ${this.id}`);
        },
        configurable: true,
      });
    }
    return 3;
  },
};
function readDoc(doc: Doc) {
  const before = doc.version;
  const verbose = settings.verbose;
  return `${before} ${verbose} ${doc.version}`;
}
function writePages(first: Page, second: Page) {
  first.version = 1;
  const text = JSON.stringify(report);
  second.version = 2;
  return `${text.length} ${first.version} ${second.version} [${Object.keys(first)}] [${Object.keys(second)}]`;
}

let length = 0;
for (let i = 0; i < 3000; i++) length += readDoc(new Doc(i)).length + writePages(new Page(i), new Page(i)).length;
console.log("warm", length);

armed = true;
const doc = new Doc(1);
console.log("the trap:", readDoc(doc), "|", readDoc(new Doc(2)), "|", Object.keys(doc).join());
armed = true;
console.log("the getter:", writePages(new Page(1), new Page(2)), "|", log.join(", "));
console.log("afterwards:", writePages(new Page(3), new Page(4)), "|", log.join(", "));
delete (Doc.prototype as any).version;
delete (Page.prototype as any).version;
console.log("gone again:", readDoc(doc), "|", writePages(new Page(5), new Page(6)), "|", log.length);
