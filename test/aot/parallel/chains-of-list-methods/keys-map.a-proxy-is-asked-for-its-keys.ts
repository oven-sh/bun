// Object.keys(o).map(f): a proxy is asked for its keys, and its traps run before the first callback
const hidden = JSON.parse('{"make":"construct"}');
const reflect: any = Reflect;
const log: string[] = [];
function note(text: string) { log.push(text); }
function show(value: any): string {
  if (!Array.isArray(value)) return typeof value + " " + String(value);
  let text = "[";
  for (let index = 0; index < value.length; index++) text += (index ? "," : "") + (index in value ? String(value[index]) : "hole");
  return text + "]";
}
function subject(o: object) { return Object.keys(o).map(key => { note("f" + key); return key + "!"; }); }
function run(o: object) {
  log.length = 0;
  let answer: string;
  try { answer = show(subject(o)); } catch (error: any) { answer = error.name + ": " + error.message; }
  console.log(answer + " | " + log.join(" "));
}
run({ a: 1, b: 2 });
for (let turn = 0; turn < 3; turn++) run({ ["k" + turn]: turn, z: 0 });
run(reflect[hidden.make](Proxy, [{ a: 1, b: 2 }, {
  ownKeys(target: object) { note("ownKeys"); return Reflect.ownKeys(target); },
  getOwnPropertyDescriptor(target: object, key: string) { note("describe " + key); return Reflect.getOwnPropertyDescriptor(target, key); },
}]));
run(reflect[hidden.make](Proxy, [{ a: 1 }, { ownKeys() { note("ownKeys"); throw new RangeError("no keys"); } }]));
run(null as any);
run("text" as any);
run([7, , 9]);
run({ a: 1, b: 2 });
