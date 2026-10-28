// Functions are written as the arguments of array methods: with a typed parameter, with a parameter of any type, and async. Most receivers are plain arrays; one has a method of its own under the same name, which gives
// the function object it is handed another name, through a value that came back out of code made at run time, and calls it. Prints what the frames call each function object, three rounds of three receivers each.
const never = process.argv.length > 1000 ? "x" : "";
const handedBack = new Function("f", "return f;" + never) as <T>(f: T) => T;
interface Problem {
  code: number;
  text: string;
}
function nameInFrame(): string {
  return new Error("x").stack!.split("\n")[2].trim().split(" ")[1];
}
type Rename = (f: Function) => void;
const renames: Record<string, Rename> = {
  displayName: f => void ((handedBack(f) as { displayName?: string }).displayName = "displayed"),
  name: f => void Object.defineProperty(handedBack(f), "name", { value: "named", configurable: true }),
};
function withOwn(method: string, rename: Rename): Problem[] {
  const list: Problem[] = [{ code: 1, text: "a" }];
  Object.defineProperty(list, method, {
    value: function own(callback: Function) {
      rename(callback);
      return callback(list[0], 0, list);
    },
    configurable: true,
  });
  return list;
}
const forms: Record<string, (list: Problem[], seen: string[]) => unknown> = {
  "every typed": (list, seen) => list.every(function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "every untyped": (list, seen) => list.every(function check(e: any) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "every async": (list, seen) => list.every(async function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "some typed": (list, seen) => list.some(function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
  "some untyped": (list, seen) => list.some(function check(e: any) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
  "some async": (list, seen) => list.some(async function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
  "filter typed": (list, seen) => list.filter(function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "filter untyped": (list, seen) => list.filter(function check(e: any) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "filter async": (list, seen) => list.filter(async function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 0;
  }),
  "map typed": (list, seen) => list.map(function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code + 1;
  }),
  "map untyped": (list, seen) => list.map(function check(e: any) {
    seen.push(nameInFrame());
    return e.code + 1;
  }),
  "map async": (list, seen) => list.map(async function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code + 1;
  }),
  "forEach typed": (list, seen) => list.forEach(function check(e: Problem) {
    seen.push(nameInFrame());
  }),
  "forEach untyped": (list, seen) => list.forEach(function check(e: any) {
    seen.push(nameInFrame());
  }),
  "forEach async": (list, seen) => list.forEach(async function check(e: Problem) {
    seen.push(nameInFrame());
  }),
  "find typed": (list, seen) => list.find(function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
  "find untyped": (list, seen) => list.find(function check(e: any) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
  "find async": (list, seen) => list.find(async function check(e: Problem) {
    seen.push(nameInFrame());
    return e.code > 9;
  }),
};
for (const [how, rename] of Object.entries(renames)) {
  for (const [form, run] of Object.entries(forms)) {
    const rounds: string[] = [];
    for (let round = 0; round < 3; round++) {
      const seen: string[] = [];
      for (const list of [[{ code: 1, text: "a" }], withOwn(form.split(" ")[0], rename), [{ code: 2, text: "b" }]]) run(list, seen);
      rounds.push(seen.join(","));
    }
    console.log(how, form, rounds.join(" | "));
  }
}
