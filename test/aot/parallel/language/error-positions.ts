// Where an error was created, by the top frames of `stack` and by `line` and `column`: the seven error classes with and without `new`, in functions and in class initializers, which stack traces hide.
// CALLS+ createWithNew operationAOTNewError
// CALLS+ createWithCall operationAOTNewError
// CALLS- createInFieldInitializer operationAOTNewError
// CALLS- createInStaticInitializer operationAOTNewError
let calls = 0;
// A constructor that nobody wrote has no place in the file: plain Bun gives it a position in the engine's own text of such a constructor (1:11, 1:28), compiled code the line of the class.
// Its frame is named here without a position, and `line` and `column` are left out where it is the top frame.
const classesWithoutConstructor = ["WithField", "Derived", "WithPrivateField", "WithNestedFunctions"];
function describe(error: unknown): string {
  const { name, message, line, column, stack } = error as any;
  const frames: string[] = [];
  for (const text of String(stack).split("\n")) {
    const constructed = /^\s*at new (\w+) \(/.exec(text)?.[1];
    if (constructed !== undefined && classesWithoutConstructor.includes(constructed)) {
      frames.push(constructed);
      continue;
    }
    const frame = /^\s*at (?:(.*?) \()?[^()]*?:(\d+):(\d+)\)?$/.exec(text) ?? /^(.*?)@.*?:(\d+):(\d+)$/.exec(text);
    if (frame) frames.push((frame[1] === "module code" || frame[1] === "<anonymous>" ? "" : (frame[1] ?? "").replace(/^new /, "")) + ":" + frame[2] + ":" + frame[3]);
  }
  const place = classesWithoutConstructor.includes(frames[0]) ? "-" : line + ":" + column;
  return name + ": " + message + " at " + place + ", stack " + frames.slice(0, 2).join(" | ");
}
export function createWithNew(kind: number, message: string): Error {
  let error: Error;
  switch (kind) {
    case 0:
      error = new Error(message);
      break;
    case 1:
      error = new EvalError(message);
      break;
    case 2:
      error = new RangeError(message);
      break;
    case 3:
      error = new ReferenceError(message);
      break;
    case 4:
      error = new SyntaxError(message);
      break;
    case 5:
      error = new TypeError(message);
      break;
    default:
      error = new URIError(message);
      break;
  }
  calls++;
  return error;
}
export function createWithCall(kind: number, message: string): Error {
  let error: Error;
  switch (kind) {
    case 0:
      error = Error(message);
      break;
    case 1:
      error = EvalError(message);
      break;
    case 2:
      error = RangeError(message);
      break;
    case 3:
      error = ReferenceError(message);
      break;
    case 4:
      error = SyntaxError(message);
      break;
    case 5:
      error = TypeError(message);
      break;
    default:
      error = URIError(message);
      break;
  }
  calls++;
  return error;
}
class WithField {
  error = new Error("instance field");
}
class WithConstructor {
  error = new TypeError("instance field, explicit constructor");
  constructor() {
    calls++;
  }
}
class Derived extends WithConstructor {
  own = new RangeError("instance field of a derived class");
}
class WithPrivateField {
  #error = SyntaxError("private field, without new");
  get error(): Error {
    return this.#error;
  }
}
class WithStatics {
  static field = new EvalError("static field");
}
class WithNestedFunctions {
  fromFunction = createWithNew(3, "function called by an initializer");
  create = () => {
    const error = new ReferenceError("arrow function created by an initializer");
    calls++;
    return error;
  };
}
export function createInFieldInitializer(): Error {
  const error = new WithField().error;
  calls++;
  return error;
}
export function createInStaticInitializer(): Error {
  class Local {
    static error = new RangeError("static field of a local class");
  }
  calls++;
  return Local.error;
}
function throwInFunction(): void {
  if (calls >= 0) throw new TypeError("thrown in a function");
  calls++;
}
function caught(run: () => void): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return "nothing was thrown";
}
for (let kind = 0; kind < 7; kind++) {
  console.log(describe(createWithNew(kind, "new")));
  console.log(describe(createWithCall(kind, "call")));
}
console.log(describe(new WithField().error));
console.log(describe(new WithConstructor().error));
console.log(describe(new Derived().own));
console.log(describe(new Derived().error));
console.log(describe(new WithPrivateField().error));
console.log(describe(WithStatics.field));
console.log(describe(new WithNestedFunctions().fromFunction));
console.log(describe(new WithNestedFunctions().create()));
console.log(describe(createInFieldInitializer()));
console.log(describe(createInStaticInitializer()));
console.log(describe(caught(throwInFunction)));
// A function that an expectation names needs code of its own: one that is inlined into all of its callers has none.
(globalThis as any).kept = [createWithNew, createWithCall, createInFieldInitializer, createInStaticInitializer];
console.log(calls);
