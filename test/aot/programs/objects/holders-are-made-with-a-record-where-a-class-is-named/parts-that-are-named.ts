const pass = new Function("value", "return value") as <T>(value: T) => T;
function put(target: any, key: string, value: unknown): void {
  target[key] = value;
}
class Part {
  words: string[] = ["a", "b", "c"];
  length: number = 3;
  name = (i: number): string => this.words[i % this.words.length] + this.length;
}
class Below extends Part {
  name = (i: number): string => "below" + i;
}
class Alike {
  name(i: number): string {
    return "alike" + i;
  }
}
type Holder = { id: number; part: Part | Alike };
function walk(holder: Holder, turns: number): string {
  let text = "";
  for (let i = 0; i < turns; i++) text = holder.part.name(i);
  return text;
}
function attempt(act: () => unknown): string {
  try {
    return String(act());
  } catch (error) {
    return (error as Error).constructor.name;
  }
}
const record = (tag: string) => ({ tags: [1], port: 80, host: "h", name: (i: number) => tag + i, secure: true, length: 5 });
const plain: Holder = { id: 0, part: new Part() };
put(plain, pass("part"), new Below());
const spread: Holder = { ...plain, ...({ id: 1, part: record("spread") } as any) };
const parsed: Holder = JSON.parse('{"id":2,"part":{"name":5}}');
class Kept {
  id = 3;
  part: Part | Alike = record("field") as any;
}
class Guarded {
  id = 4;
  #part: Part | Alike = new Part();
  get part(): Part | Alike {
    return this.#part;
  }
  set part(value: Part | Alike) {
    this.#part = value;
  }
}
const guarded = new Guarded();
(guarded as any).part = record("setter");
const literal: Holder = { id: 5, part: record("literal") as any };
const copied: Holder = Object.assign({ id: 6, part: new Part() }, { part: record("copied") } as any);
const cloned: Holder = structuredClone({ id: 7, part: { length: 1 } }) as any;
const entries: Holder = Object.fromEntries([["id", 8], ["part", record("entries")]] as [string, unknown][]) as any;
function once(holder: Holder): string {
  return holder.part.name(7);
}
for (const holder of [plain, spread, parsed, new Kept(), guarded, literal, copied, cloned, entries]) console.log(holder.id, attempt(() => once(holder)), attempt(() => walk(holder, 300)));
