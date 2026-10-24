// `{ [key]: value }`: ECMAScript converts the key to a property key before it evaluates the value. Plain Bun evaluates the value first, so this program has an .expected.txt.
const trail: string[] = [];
const mark = Symbol("mark");

function noted<T>(value: T, name: string): T {
  trail.push(name);
  return value;
}
function keyBetween(key: any): object {
  return { a: noted(1, "a"), [noted(key, "key")]: noted("computed", "value"), b: noted(2, "b") };
}
function look(name: string, key: unknown): void {
  let answer: string;
  try {
    answer = Reflect.ownKeys(keyBetween(key)).map(String).join();
  } catch (error) {
    answer = "throws " + (error as Error).constructor.name;
  }
  console.log(name + ":", answer, "|", trail.splice(0).join(";"));
}

for (let round = 0; round < 3; round++) {
  look("a text", "c");
  look("an object that converts", {
    toString() {
      trail.push("converted");
      return "a";
    },
  });
  look("an object that converts by a symbol", {
    [Symbol.toPrimitive](hint: string) {
      trail.push("hint " + hint);
      return mark;
    },
  });
  look("an object that throws", {
    toString() {
      throw new RangeError("no key");
    },
  });
  look("an object that cannot be converted", Object.create(null));
}
