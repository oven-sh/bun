// Methods found through instances: each class here has a toJSON(scale: number) that the program calls with a number and that one native caller calls with the key, a string. A bit is set for each such caller.
import { format } from "node:util";

let bits = 0;

function attempt(run: () => unknown): void {
  try {
    run();
  } catch {}
}

class AtTop { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 1; return 0; } }
class InProperty { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 2; return 0; } }
class InArray { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 4; return 0; } }
class WithReplacer { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 8; return 0; } }
class WithList { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 16; return 0; } }
class WithIndent { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 32; return 0; } }
class ByResponse { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 64; return 0; } }
class ByResponseNested { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 128; return 0; } }
class ByFormat { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 256; return 0; } }
class FromToJSON { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 512; return 0; } }
class FromReplacer { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 1024; return 0; } }
class InGetter { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 2048; return 0; } }
class InProxy { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 4096; return 0; } }
class InInherited { toJSON(scale: number): number { if (typeof scale !== "number") bits |= 8192; return 0; } }

new AtTop().toJSON(2);
attempt(() => JSON.stringify((new AtTop() as any)));
new InProperty().toJSON(2);
attempt(() => JSON.stringify({ a: (new InProperty() as any) }));
new InArray().toJSON(2);
attempt(() => JSON.stringify([(new InArray() as any)]));
new WithReplacer().toJSON(2);
attempt(() => JSON.stringify({ a: (new WithReplacer() as any) }, (key, value) => value));
new WithList().toJSON(2);
attempt(() => JSON.stringify({ a: (new WithList() as any) }, ["a"]));
new WithIndent().toJSON(2);
attempt(() => JSON.stringify([(new WithIndent() as any)], null, 2));
new ByResponse().toJSON(2);
attempt(() => Response.json((new ByResponse() as any)));
new ByResponseNested().toJSON(2);
attempt(() => Response.json({ a: [(new ByResponseNested() as any)] }));
new ByFormat().toJSON(2);
attempt(() => format("%j", (new ByFormat() as any)));
new FromToJSON().toJSON(2);
attempt(() => JSON.stringify({ toJSON: () => (new FromToJSON() as any) }));
new FromReplacer().toJSON(2);
attempt(() => JSON.stringify(1, () => (new FromReplacer() as any)));
new InGetter().toJSON(2);
attempt(() => JSON.stringify({ get a() { return (new InGetter() as any); } }));
new InProxy().toJSON(2);
attempt(() => JSON.stringify(new Proxy({ a: (new InProxy() as any) }, {})));
new InInherited().toJSON(2);
attempt(() => JSON.stringify(Object.create((new InInherited() as any))));
console.log(bits.toString(2));
