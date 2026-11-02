// A name that the instances of a class or of a constructor function have as a method or as a field is given to one of them again, each way the language has, and read behind that in a loop.
const lines: string[] = [];
const show = (label: string, value: unknown) => lines.push(label + ": " + JSON.stringify(value));
class WithMethod {
  #secret() {
    return 3;
  }
  answer() {
    return this.#secret();
  }
}
class WithField {
  answer = () => 4;
}
class Below extends WithMethod {
  answer = () => 5;
}
function Plain(this: any, fill: (made: any) => void) {
  fill(this);
}
const fillPlain = (made: any) => {
  Object.defineProperty(made, "answer", { value: () => 6, enumerable: false });
  made.other = 1;
};
const makers = {
  method: () => new WithMethod(),
  field: () => new WithField(),
  below: () => new Below(),
  plain: () => new (Plain as any)(fillPlain),
};
const ways = {
  "Reflect.set": (object: any) => Reflect.set(object, "answer", () => 33),
  "Reflect.set with a receiver": (object: any) => Reflect.set(Object.getPrototypeOf(object), "answer", () => 34, object),
  "store": (object: any) => {
    try {
      object.answer = () => 35;
      return true;
    } catch (error: any) {
      return error.constructor.name;
    }
  },
  "defineProperty plain": (object: any) => attempt(() => Object.defineProperty(object, "answer", { value: () => 36, writable: true, enumerable: true, configurable: true }) === object),
  "defineProperty hidden": (object: any) => attempt(() => Object.defineProperty(object, "answer", { value: () => 37 }) === object),
  "defineProperty quiet": (object: any) => attempt(() => Object.defineProperty(object, "answer", { value: () => 38, writable: true, configurable: true }) === object),
  "defineProperty getter": (object: any) => attempt(() => Object.defineProperty(object, "answer", { get: () => () => 39, configurable: true }) === object),
  "Reflect.defineProperty": (object: any) => Reflect.defineProperty(object, "answer", { value: () => 40, enumerable: true }),
  "defineProperties": (object: any) => attempt(() => Object.defineProperties(object, { answer: { value: () => 41, configurable: true } }) === object),
  "Object.assign": (object: any) => attempt(() => Object.assign(object, { answer: () => 42 }) === object),
  "delete then store": (object: any) => {
    const deleted = attempt(() => delete object.answer);
    return [deleted, attempt(() => ((object.answer = () => 43), true))];
  },
  "delete then define": (object: any) => {
    const deleted = attempt(() => delete object.answer);
    return [deleted, attempt(() => Object.defineProperty(object, "answer", { value: () => 44, enumerable: false }) === object)];
  },
  "store under a key": (object: any) => attempt(() => ((object[["ans", "wer"].join("")] = () => 45), true)),
  "twice": (object: any) => [Reflect.set(object, "answer", () => 46), attempt(() => Object.defineProperty(object, "answer", { value: () => 47 }) === object), Reflect.set(object, "answer", () => 48)],
};
function attempt(action: () => unknown) {
  try {
    return action();
  } catch (error: any) {
    return error.constructor.name;
  }
}
function ask(object: { answer(): number }) {
  let sum = 0;
  for (let turn = 0; turn < 50; turn++) sum += object.answer();
  return sum;
}
for (const [kind, make] of Object.entries(makers)) {
  for (const [name, change] of Object.entries(ways)) {
    const changed = make();
    const untouched = make();
    const before = ask(changed);
    const answer = change(changed);
    const descriptor = Object.getOwnPropertyDescriptor(changed, "answer");
    show(kind + " | " + name, [before, answer, ask(changed), ask(untouched), Object.keys(changed), descriptor && [descriptor.writable, descriptor.enumerable, descriptor.configurable, typeof descriptor.get]]);
  }
}
console.log(lines.join("\n"));
