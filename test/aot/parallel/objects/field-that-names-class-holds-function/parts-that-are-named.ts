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
const named = <T extends object>(value: T, tag: string): T => Object.assign(value, { name: (i: number) => tag + i });
const stranger: unknown = function walker() {};
const holder: Holder = { id: 0, part: new Part() };
put(holder, pass("part"), new Below());
(holder as any)["part"] = stranger;
console.log(typeof stranger, attempt(() => walk(holder, 2000)));
