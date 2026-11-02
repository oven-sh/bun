// Spreads and rests whose source is not of the type of the literal, in a program that is built with all its code cold: each copy is one call of the run time, which repeats what it did for the copy before.
class Holder { a = 1; b = 2; c = "three"; d = 4; }
function fillByKey(): any {
  const made: any = {};
  for (const name of ["a", "b", "c", "d"]) made[name] = name.length;
  return made;
}
const sources: Record<string, any[]> = {
  "an instance": [new Holder(), new Holder()],
  "a parsed object": [JSON.parse('{"a":1,"b":2,"c":"three","d":4}'), JSON.parse('{"a":5,"b":6,"c":"seven","d":8}')],
  "an object filled by key": [fillByKey(), fillByKey()],
};
const forms: Record<string, (source: any, i: number) => any> = {
  "no copy": (source, i) => ({ label: i }),
  "a spread behind a member": (source, i) => ({ label: i, ...source }),
  "a spread over defaults": (source, i) => ({ a: 0, b: 0, c: "", d: 0, ...source }),
  "a rest": (source, i) => { const { a, ...rest } = source; return rest; },
  "a rest under a key": (source, i) => { const key = i & 1 ? "a" : "b"; const { [key]: taken, ...rest } = source; return rest; },
};
let kept: any = null;
function run(form: string, source: string, rounds: number): number {
  const copy = forms[form];
  const list = sources[source];
  let sum = 0;
  for (let i = 0; i < rounds; i++) {
    kept = copy(list[i & 1], i);
    if (kept) sum++;
  }
  return sum;
}
const which = process.argv[2] ?? "";
const rounds = Number(process.argv[3] ?? "6");
function show(form: string, source: string) {
  console.log(form, "of", source, run(form, source, rounds), JSON.stringify(kept));
}
if (which) {
  const [form, source] = which.split(" of ");
  show(form, source);
} else for (const form in forms) for (const source in sources) show(form, source);
