Error.stackTraceLimit = 12;
function frames(stack) {
  return stack
    .split("\n")
    .slice(1)
    .map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/]+?)\)?$/, "$1"))
    .join(" | ");
}
function seen(label) {
  console.log(label, frames(new Error("seen").stack));
}
const thenable = {
  get then() {
    seen("then");
    return undefined;
  },
};
const throwing = {
  get then() {
    seen("then that throws");
    throw new RangeError("no");
  },
};
const proxy = new Proxy({}, {
  get(target, key) {
    if (key === "then") seen("trap");
    return undefined;
  },
});
class Below {
  get then() {
    seen("then of the class");
    return undefined;
  }
}

async function returnsLater(wait, flag) {
  await wait;
  if (flag === 1) return thenable;
  await wait;
  if (flag === 2)
    return thenable;
  return thenable;
}
const arrowLater = async wait => {
  await wait;
  return thenable;
};
const holder = {
  async method(wait) {
    await wait;
    return proxy;
  },
};
class Methods {
  async method(wait) {
    await wait;
    return new Below();
  }
  static async fixed(wait) {
    try {
      await wait;
      return thenable;
    } finally {
      seen("finally");
    }
  }
}
async function returnsAtOnceButAwaitsElsewhere(flag, wait) {
  if (flag) return thenable;
  await wait;
  return 1;
}
async function returnsWhatThrows(wait) {
  await wait;
  try {
    return throwing;
  } catch (error) {
    seen("never caught here");
  }
}
async function waitsForIt(wait) {
  await returnsLater(wait, 1);
  seen("behind the wait");
}
async function waitsForWhatThrows(wait) {
  await returnsWhatThrows(wait);
}

async function awaitsAtOnce() {
  await thenable;
  seen("behind the first await");
}
async function awaitsLater(wait) {
  await wait;
  await thenable;
  await proxy;
  await new Below();
}
function makes() {
  return thenable;
}
async function awaitsCall(wait) {
  await wait;
  await makes();
}
async function awaitsInTry(wait) {
  try {
    await throwing;
  } catch (error) {
    seen("caught " + error.message);
  }
  await wait;
  try {
    return await throwing;
  } catch (error) {
    seen("caught again " + error.message);
  }
}
async function awaitsInLoop() {
  for (let turn = 0; turn < 2; turn++) await thenable;
}
function calls() {
  const promise = awaitsAtOnce();
  return promise;
}
async function walks(wait) {
  await wait;
  for await (const each of [thenable]) seen("body");
}
async function inner(wait) {
  await wait;
  seen("inner");
  throw new Error("thrown");
}
async function outer(wait) {
  await inner(wait);
}

for (const flag of [1, 2, 3]) await returnsLater(null, flag);
await arrowLater(null);
await holder.method(null);
await new Methods().method(null);
await Methods.fixed(null);
await returnsAtOnceButAwaitsElsewhere(true, null);
await returnsWhatThrows(null).catch(error => console.log("rejected", error.message, frames(error.stack)));
await waitsForIt(null);
await waitsForWhatThrows(null).catch(error => console.log("rejected", error.message, frames(error.stack)));
await awaitsAtOnce();
await awaitsLater(null);
await awaitsCall(null);
await awaitsInTry(null);
await awaitsInLoop();
await calls();
await walks(null);
await outer(null).catch(error => console.log("rejected", error.message, frames(error.stack)));
await thenable;

const captured = {
  get then() {
    const into = {};
    Error.captureStackTrace(into);
    console.log("captured", frames(into.stack));
    return undefined;
  },
};
await (async wait => {
  await wait;
  return captured;
})(null);

Error.prepareStackTrace = (error, sites) => sites.map(site => (site.isAsync() ? "async " : "") + site.getFunctionName() + ":" + site.getLineNumber()).join(" | ");
const prepared = {
  get then() {
    console.log("prepared", new Error("seen").stack);
    return undefined;
  },
};
async function returnsPrepared(wait) {
  await wait;
  return prepared;
}
async function waitsForPrepared(wait) {
  await returnsPrepared(wait);
  console.log("prepared behind the wait", new Error("seen").stack);
}
await waitsForPrepared(null);
