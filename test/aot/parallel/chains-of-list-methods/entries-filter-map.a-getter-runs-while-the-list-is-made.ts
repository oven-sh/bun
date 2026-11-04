// Object.entries(o).filter(f).map(g): getters of the object run while the list is made, and one of them takes a later name away
const hidden = JSON.parse('{"define":"defineProperty","remove":"deleteProperty"}');
const reflect: any = Reflect;
const log: string[] = [];
function note(text: string) { log.push(text); }
function show(value: any): string {
  if (!Array.isArray(value)) return typeof value + " " + String(value);
  let text = "[";
  for (let index = 0; index < value.length; index++) text += (index ? "," : "") + (index in value ? String(value[index]) : "hole");
  return text + "]";
}
function subject(o: Record<string, number>) {
  return Object.entries(o).filter(pair => { note("f" + pair[0]); return pair[1] > 1; }).map(pair => { note("g" + pair[0]); return pair[0] + pair[1]; });
}
function run(o: Record<string, number>) {
  log.length = 0;
  let answer: string;
  try { answer = show(subject(o)); } catch (error: any) { answer = error.name + ": " + error.message; }
  console.log(answer + " | " + log.join(" "));
}
function withGetters() {
  const o: Record<string, number> = { a: 1, b: 2, c: 3, d: 4 };
  reflect[hidden.define](o, "b", { get() { note("get b"); reflect[hidden.remove](o, "c"); return 5; }, enumerable: true, configurable: true });
  reflect[hidden.define](o, "d", { get() { note("get d"); return 6; }, enumerable: true, configurable: true });
  return o;
}
function withGetterThatThrows() {
  const o: Record<string, number> = { a: 2, b: 2 };
  reflect[hidden.define](o, "b", { get() { note("get b"); throw new RangeError("b"); }, enumerable: true, configurable: true });
  return o;
}
run({ a: 1, b: 2, c: 3 });
for (let turn = 0; turn < 3; turn++) run({ a: turn, b: 2, c: 0 });
run(withGetters());
run(withGetterThatThrows());
run({ a: 1, b: 2, c: 3 });
