// Await of everything that is not a native promise, ordered against other microtasks, and generators whose prototype was replaced.
const log = line => console.log(line);

function thenableWithGetter(label, value) {
  return {
    get then() {
      log(label + ": then getter");
      return resolve => {
        log(label + ": then called");
        resolve(value);
      };
    },
  };
}

class CountingPromise extends Promise {}

function tick(label, count) {
  let promise = Promise.resolve();
  for (let i = 0; i < count; i++) promise = promise.then(() => log(label + " tick " + i));
  return promise;
}

async function awaitsInFunction(label) {
  log(label + ": start");
  log(label + ": thenable gave " + (await thenableWithGetter(label, 1)));
  log(label + ": subclass gave " + (await CountingPromise.resolve(2)));
  log(label + ": primitive gave " + (await 3));
  log(label + ": undefined gave " + (await undefined));
  log(label + ": native gave " + (await Promise.resolve(4)));
  return label + " done";
}

async function* awaitsInGenerator(label) {
  log(label + ": start");
  yield await thenableWithGetter(label, 1);
  yield await CountingPromise.resolve(2);
  yield await 3;
  yield await Promise.resolve(4);
  return label + " done";
}

async function throwsBeforeAwait() {
  log("throws before await: start");
  throw new Error("before the first await");
}

async function* throwsBeforeAwaitInGenerator() {
  log("generator throws before await: start");
  throw new Error("before the first await in a generator");
}

async function rejectsThroughThenable() {
  try {
    await {
      then(resolve, reject) {
        reject(new Error("rejected by thenable"));
      },
    };
  } catch (error) {
    return "caught " + error.message;
  }
}

async function throwingThenGetter() {
  try {
    await {
      get then() {
        throw new Error("then getter threw");
      },
    };
  } catch (error) {
    return "caught " + error.message;
  }
}

function* counts() {
  yield 1;
}
const replacement = {
  marker: "replaced",
  next() {
    return { done: true, value: "from replacement" };
  },
};
const beforeReplacement = counts();
counts.prototype = replacement;
const afterReplacement = counts();

async function main() {
  const inFunction = awaitsInFunction("function");
  const ticks = tick("function", 6);
  log(await inFunction);
  await ticks;

  const generator = awaitsInGenerator("generator");
  const generatorTicks = tick("generator", 6);
  for (let step = await generator.next(); ; step = await generator.next()) {
    log("generator step " + step.value + " " + step.done);
    if (step.done) break;
  }
  await generatorTicks;

  const rejected = throwsBeforeAwait();
  log("after call that throws before await");
  await rejected.catch(error => log("caught " + error.message));

  const rejectedGenerator = throwsBeforeAwaitInGenerator();
  log("after generator call");
  await rejectedGenerator.next().catch(error => log("caught " + error.message));

  log(await rejectsThroughThenable());
  log(await throwingThenGetter());

  log("before replacement: " + (beforeReplacement.marker === undefined) + " " + beforeReplacement.next().value);
  log("after replacement: " + afterReplacement.marker + " " + afterReplacement.next().value);
  log("instance of replaced function: " + (afterReplacement instanceof counts) + " " + (beforeReplacement instanceof counts));
}

main();
