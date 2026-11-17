// With emitDecoratorMetadata the decorator that Reflect.metadata() answers with is handed the same key as the written ones.
const seen: string[] = [];
const spell = (key: unknown) => `${typeof key} ${String(key)}`;
(Reflect as any).metadata = (name: string, _value: unknown) => (_target: object, key: any) => { seen.push(`${name} under ${spell(key)}`); };
function note(_target: object, key: any, _third?: any) { seen.push(`noted ${spell(key)}`); }
const one = 1, three = 3, word = "worded";
class Holder {
  @note [one](_value: number): string { return ""; }
  @note [word](_value: string): number { return 0; }
  @note [three]: number = 0;
}
new Holder();
for (const line of seen) console.log(line);
