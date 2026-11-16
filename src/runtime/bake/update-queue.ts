export function createUpdateQueue<Args extends unknown[]>(apply: (...args: Args) => Promise<void>) {
  let pending: Promise<void> | null = null;
  return function enqueueUpdate(...args: Args): Promise<void> {
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    const operation = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    const previous = pending;
    pending = operation;
    const start = () => {
      try {
        apply(...args).then(resolve, reject);
      } catch (error) {
        reject(error);
      }
    };
    if (previous) previous.then(start, start);
    else start();
    return operation.finally(() => {
      if (pending === operation) pending = null;
    });
  };
}
