// Stack frames name the source function, whichever compiled form of it was running when the error was thrown.
function framesOf(error) {
  return error.stack
    .split("\n")
    .filter(line => line.includes("stack-frames-of-derived-functions") && !line.includes("module code"))
    .map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at "))
    .join(" | ");
}

function show(label, action, describe = error => error.message) {
  try {
    action();
    console.log(label, "did not throw");
  } catch (error) {
    console.log(label, describe(error), framesOf(error));
  }
}

function plainLeaf() {
  throw new Error("plain");
}
function plainMiddle() {
  plainLeaf();
}
function plainRoot() {
  plainMiddle();
}
show("plain call chain:", plainRoot);

async function throwsAfterAwait() {
  await null;
  throw new Error("async");
}

function* throwsInGenerator() {
  yield 1;
  throw new Error("generator");
}
show("generator:", () => {
  const generator = throwsInGenerator();
  generator.next();
  generator.next();
});

function boundTarget() {
  throw new Error(`bound ${this.label}`);
}
show("bound target:", boundTarget.bind({ label: "receiver" }));

function readsField(object) {
  return object.field;
}
const calledThroughValue = [readsField];
// Plain Bun builds this message from source text, which compiled code does not have.
show("wrong type:", () => calledThroughValue[0](null), error => error.name);

const first = (() => {
  function sameName() { throw new Error("first"); }
  return sameName;
})();
const second = (() => {
  function sameName() { throw new Error("second"); }
  return sameName;
})();
show("same name, first:", first);
show("same name, second:", second);

try {
  await throwsAfterAwait();
} catch (error) {
  console.log("async:", error.message, framesOf(error));
}
