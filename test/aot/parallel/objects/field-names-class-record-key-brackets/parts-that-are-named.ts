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
const record = { tags: [1], port: 80, host: "h", name: (i: number) => "record" + i, secure: true, length: 5 };
const holder: Holder = { id: 0, part: new Part() };
put(holder, pass("part"), new Below());
(holder as any)["part"] = record;
console.log(walk(holder, 2000));
