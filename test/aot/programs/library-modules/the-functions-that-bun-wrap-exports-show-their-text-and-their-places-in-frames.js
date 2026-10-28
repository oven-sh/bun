// Prints the text of every function that "bun:wrap" exports, and the frames inside them with file, line and column, as `bun run` shows them.
const helpers = require("bun:wrap");

for (const name of Object.keys(helpers).sort()) {
  const helper = helpers[name];
  console.log(name, typeof helper === "function" ? [helper.name, helper.length, String(helper)] : typeof helper);
}

function showHelperFrames(label, run) {
  try {
    console.log(label, "returned", run());
  } catch (error) {
    const frames = error.stack.split("\n").filter(frame => frame.includes("bun:wrap"));
    console.log(label, String(error), frames.map(frame => frame.trim()).join(" | "));
  }
}

function fail() {
  throw new Error("thrown");
}
class Target {
  method() {}
}
showHelperFrames("a class decorator", () => helpers.__legacyDecorateClassTS([fail], Target));
showHelperFrames("a member decorator", () => helpers.__legacyDecorateClassTS([fail], Target.prototype, "method", null));
showHelperFrames("a parameter decorator", () => helpers.__legacyDecorateParamTS(0, fail)(Target, "method"));
showHelperFrames("the body of a file", () => helpers.__commonJS(fail)());
showHelperFrames("the body of a module", () => helpers.__esm(fail)());
showHelperFrames("a getter of an export", () => helpers.__export({}, new Proxy({ a: 1 }, { get: fail })));
showHelperFrames("the keys of what is exported again", () => helpers.__reExport({}, new Proxy({}, { ownKeys: fail })));
showHelperFrames("the keys of a required object", () => helpers.__toESM(new Proxy({}, { ownKeys: fail })));
showHelperFrames("the keys of a namespace", () => helpers.__toCommonJS(new Proxy({}, { ownKeys: fail })));
showHelperFrames("a private field that is absent", () => helpers.__privateGet({}, new WeakMap()));
showHelperFrames("a private field added twice", () => helpers.__privateAdd(Target, new WeakSet([Target])));
showHelperFrames("in, of what is no object", () => helpers.__privateIn(new WeakSet(), 1));
showHelperFrames("a resource that is no object", () => helpers.__using([], 1, false));
showHelperFrames("a resource without a method", () => helpers.__using([], {}, true));
showHelperFrames("a resource whose disposal throws", () =>
  helpers.__callDispose([[false, fail, {}]], undefined, false),
);
showHelperFrames("an initializer", () => helpers.__runInitializers([, , [fail]], 5, Target));
showHelperFrames("a decorator of the standard", () =>
  helpers.__decorateElement(helpers.__decoratorStart(undefined), 1, "method", [fail], Target),
);
showHelperFrames("a decorator that answers a number", () =>
  helpers.__decorateElement(helpers.__decoratorStart(undefined), 1, "method", [() => 1], Target),
);
showHelperFrames("text that is no JSON", () => helpers.__jsonParse("{"));
