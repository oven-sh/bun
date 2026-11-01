// Object.hasOwn and hasOwnProperty ask a proxy that is made right where it is asked, so the compiler knows its target and its handler. The trap, a getter that hands out the trap, or a getter
// of the descriptor that the trap answers takes a stack trace or throws, and so do the function's own checks of the trap and of its answer. Each row prints the frames down to `start`: their
// names, and for a built-in function what stands in the place of its file.
const framesOf = stack => {
  const frames = String(stack)
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/^at /, ""))
    .map(frame =>
      frame.includes(" (") ? frame.replace(/\((native|unknown)?.*\)/, (place, word = "file") => `(${word})`) : "(file)",
    );
  const end = frames.findIndex(frame => frame.startsWith("start "));
  return frames.slice(0, end + 1).join(" < ");
};
let seen = "";
function look() {
  seen = framesOf(new Error().stack);
}
function capture() {
  const holder = {};
  Error.captureStackTrace(holder);
  seen = framesOf(holder.stack);
}
function listCallSites() {
  const prepare = Error.prepareStackTrace;
  Error.prepareStackTrace = (error, sites) => sites.map(site => `${site.getFunctionName()} ${site.isNative()}`);
  const names = new Error().stack;
  Error.prepareStackTrace = prepare;
  seen = names.slice(0, names.findIndex(name => name.startsWith("start ")) + 1).join(" < ");
}
function fail() {
  throw new RangeError("thrown below");
}
function start(run, act) {
  seen = "";
  try {
    const result = run(act);
    return seen + " | " + typeof result;
  } catch (error) {
    return error.name + ": " + error.message.replace(/ \(evaluating '.*'\)$/s, "") + " | " + framesOf(error.stack);
  }
}
const rows = {
  hasOwn: act =>
    Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor(target, name) {
            act();
            return Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      ),
      "a",
    ),
  hasOwnKept: act => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor(target, name) {
            act();
            return Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  hasOwnInCondition: act =>
    Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor(target, name) {
            act();
            return Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      ),
      "a",
    )
      ? 1
      : 2,
  hasOwnInTry: act => {
    try {
      return Object.hasOwn(
        new Proxy(
          { a: 1 },
          {
            getOwnPropertyDescriptor() {
              act();
            },
          },
        ),
        "a",
      );
    } finally {
      seen += " finally";
    }
  },
  hasOwnPropertyCalled: act =>
    Object.prototype.hasOwnProperty.call(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor(target, name) {
            act();
            return Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      ),
      "a",
    ),
  hasOwnPropertyCalledKept: act => {
    const kept = Object.prototype.hasOwnProperty.call(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor(target, name) {
            act();
            return Reflect.getOwnPropertyDescriptor(target, name);
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  trapCallsAnotherFunction: act => {
    const inner = () => act();
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor() {
            inner();
            return undefined;
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  trapAsksAnotherProxy: act => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor() {
            const asked = Object.hasOwn(
              new Proxy(
                { b: 1 },
                {
                  getOwnPropertyDescriptor() {
                    act();
                  },
                },
              ),
              "b",
            );
            return asked ? undefined : { value: 1, writable: true, enumerable: true, configurable: true };
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  trapBehindGetter: act => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          get getOwnPropertyDescriptor() {
            act();
            return undefined;
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  trapOfHandlerThatIsProxy: act => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        new Proxy(
          {},
          {
            get() {
              act();
              return undefined;
            },
          },
        ),
      ),
      "a",
    );
    return [kept];
  },
  trapIsNoFunction: () => {
    const kept = Object.hasOwn(new Proxy({ a: 1 }, { getOwnPropertyDescriptor: 1 }), "a");
    return [kept];
  },
  trapIsNoFunctionInTailPosition: () => Object.hasOwn(new Proxy({ a: 1 }, { getOwnPropertyDescriptor: 1 }), "a"),
  answerIsNoObject: () => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor() {
            return 1;
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  answerWithGetter: act => {
    const kept = Object.hasOwn(
      new Proxy(
        { a: 1 },
        {
          getOwnPropertyDescriptor() {
            return {
              get configurable() {
                act();
                return true;
              },
              value: 1,
              writable: true,
              enumerable: true,
            };
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  hidesWhatIsFixed: () => {
    const kept = Object.hasOwn(
      new Proxy(Object.freeze({ a: 1 }), {
        getOwnPropertyDescriptor() {
          return undefined;
        },
      }),
      "a",
    );
    return [kept];
  },
  proxyOfProxy: act => {
    const kept = Object.hasOwn(
      new Proxy(
        new Proxy(
          { a: 1 },
          {
            getOwnPropertyDescriptor(target, name) {
              act();
              return Reflect.getOwnPropertyDescriptor(target, name);
            },
          },
        ),
        {},
      ),
      "a",
    );
    return [kept];
  },
  proxyOfProxyInTailPosition: act =>
    Object.hasOwn(
      new Proxy(
        new Proxy(
          { a: 1 },
          {
            getOwnPropertyDescriptor(target, name) {
              act();
              return Reflect.getOwnPropertyDescriptor(target, name);
            },
          },
        ),
        {},
      ),
      "a",
    ),
  reflectGet: act => {
    const kept = Reflect.get(
      new Proxy(
        { a: 1 },
        {
          get(target, name) {
            act();
            return target[name];
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  reflectHas: act => {
    const kept = Reflect.has(
      new Proxy(
        { a: 1 },
        {
          has(target, name) {
            act();
            return name in target;
          },
        },
      ),
      "a",
    );
    return [kept];
  },
  reflectSet: act => {
    const kept = Reflect.set(
      new Proxy(
        { a: 1 },
        {
          set(target, name, value) {
            act();
            target[name] = value;
            return true;
          },
        },
      ),
      "a",
      2,
    );
    return [kept];
  },
};
for (const [name, run] of Object.entries(rows)) {
  console.log(name, "looks:", start(run, look));
  console.log(name, "captures:", start(run, capture));
  console.log(name, "lists call sites:", start(run, listCallSites));
  console.log(name, "fails:", start(run, fail));
}
