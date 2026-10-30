// `ledger.shelf.get(i)`: the type of the field names a class. A store under a key that nobody knows lets two records with a field `get` pass by the same place, and at times one of them does lie in the field.
class Shelf { texts: string[] = [" ", "a", "b"]; get(i: number): string { return this.texts[i] ?? "?"; } }
class Wide extends Shelf { get(i: number): string { return super.get(i) + super.get(i); } }
type Ledger = { codes: Int32Array; shelf: Shelf };
type Entry = { label: string; weight: number };
const first = { get(i: number) { return "first" + i; }, port: 80 };
const second = { get(i: number) { return "second" + i; }, port: 443, secure: true };
const pass = new Function("value", process.argv.length > 99 ? "" : "return value") as <T>(value: T) => T;
function put(target: any, key: string, value: unknown) { target[key] = value; }
const clients: Record<string, unknown> = {};
put(clients, pass("http"), first);
put(clients, pass("https"), second);

function entryAt(ledger: Ledger, i: number, out: Entry): void {
  const word = ledger.codes[i | 1]!;
  out.label = ledger.shelf.get(ledger.codes[i]!);
  out.weight = word & 3;
}

function walk(ledger: Ledger, turns: number): string {
  const out: Entry = { label: "", weight: 0 };
  let text = "", weight = 0;
  for (let i = 0; i < turns; i++) {
    entryAt(ledger, i & 15, out);
    if (i < 4) text += out.label + ",";
    weight += out.weight + String(out.label).length;
  }
  return text + weight;
}

const ledger: Ledger = { codes: new Int32Array(32).map((_, i) => i % 3), shelf: new Shelf() };
put(ledger, pass("shelf"), pass(new Shelf()));
console.log(walk(ledger, 2000));
put(ledger, pass("shelf"), new Wide());
console.log(walk(ledger, 2000));
for (const client of [first, second]) {
  put(ledger, pass("shelf"), client);
  console.log(walk(ledger, 2000));
}
put(ledger, pass("shelf"), { get: (i: number) => i * 2 });
console.log(walk(ledger, 2000));
Shelf.prototype.get = function (i: number) { return "<" + i + ">"; };
put(ledger, pass("shelf"), new Shelf());
console.log(walk(ledger, 2000));
const own = new Shelf();
(own as any).get = (i: number) => "own" + i;
put(ledger, pass("shelf"), own);
console.log(walk(ledger, 2000));
for (const nothing of [undefined, null]) {
  put(ledger, pass("shelf"), nothing);
  try { console.log(walk(ledger, 3)); } catch (error) { console.log((error as Error).constructor.name, String((error as Error).message).length > 0); }
}
delete (ledger as any).shelf;
try { console.log(walk(ledger, 3)); } catch (error) { console.log((error as Error).constructor.name); }
Object.setPrototypeOf(ledger, { shelf: second });
console.log(walk(ledger, 3));
