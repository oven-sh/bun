const unseen = <T,>(x: T): T => [x][JSON.parse("0")];
type Kit = { ns: typeof Array };
const kits: Kit[] = [{ ns: Array }, { ns: Array }, { ns: Array }];
kits.push(unseen({ ns: { isArray: () => "fake" } } as any));
function noise(): number { return unseen(0); }
function read(i: number): unknown {
  const kit = kits[i];
  const f = kit.ns.isArray as any;
  if (i < 0) return "never";
  return f([]);
}
const run = unseen(read);
let last: unknown;
for (let r = 0; r < 300; r++) last = run(r % 3);
console.log(String(last), String(run(3)));
