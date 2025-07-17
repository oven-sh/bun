/**
 * p-limit@6.2.0
 * https://github.com/sindresorhus/p-limit
 * MIT (c) Sindre Sorhus
 */

import Queue from "./yocto-queue.mjs";

export default function pLimit(concurrency) {
  validateConcurrency(concurrency);

  const queue = new Queue();
  let activeCount = 0;

  const resumeNext = () => {
    if (activeCount < concurrency && queue.size > 0) {
      queue.dequeue()();
      // Since `pendingCount` has been decreased by one, increase `activeCount` by one.
      activeCount++;
    }
  };

  const next = () => {
    activeCount--;

    resumeNext();
  };

  const run = async (function_, resolve, arguments_) => {
    const result = (async () => function_(...arguments_))();

    resolve(result);

    try {
      await result;
    } catch {}

    next();
  };

  const enqueue = (function_, resolve, arguments_) => {
    // Queue `internalResolve` instead of the `run` function
    // to preserve asynchronous context.
    new Promise(internalResolve => {
      queue.enqueue(internalResolve);
    }).then(run.bind(undefined, function_, resolve, arguments_));

    (async () => {
      // This function needs to wait until the next microtask before comparing
      // `activeCount` to `concurrency`, because `activeCount` is updated asynchronously
      // after the `internalResolve` function is dequeued and called. The comparison in the if-statement
      // needs to happen asynchronously as well to get an up-to-date value for `activeCount`.
      await Promise.resolve();

      if (activeCount < concurrency) {
        resumeNext();
      }
    })();
  };

  const generator = (function_, ...arguments_) =>
    new Promise(resolve => {
      enqueue(function_, resolve, arguments_);
    });

  Object.defineProperties(generator, {
    activeCount: {
      get: () => activeCount,
    },
    pendingCount: {
      get: () => queue.size,
    },
    clearQueue: {
      value() {
        queue.clear();
      },
    },
    concurrency: {
      get: () => concurrency,

      set(newConcurrency) {
        validateConcurrency(newConcurrency);
        concurrency = newConcurrency;

        queueMicrotask(() => {
          // eslint-disable-next-line no-unmodified-loop-condition
          while (activeCount < concurrency && queue.size > 0) {
            resumeNext();
          }
        });
      },
    },
  });

  return generator;
}

export function limitFunction(function_, option) {
  const { concurrency } = option;
  const limit = pLimit(concurrency);

  return (...arguments_) => limit(() => function_(...arguments_));
}

function validateConcurrency(concurrency) {
  if (!((Number.isInteger(concurrency) || concurrency === Number.POSITIVE_INFINITY) && concurrency > 0)) {
    throw new TypeError("Expected `concurrency` to be a number from 1 and up");
  }
}
