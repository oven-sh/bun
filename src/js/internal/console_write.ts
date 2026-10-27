// How a Console writes to a stream whose errors it ignores (node's kWriteToConsole), for the Console of node:console and for the console of a node:worker_threads worker.

function noop() {}

// An error of the stream, thrown or emitted, does not reach the caller. A stack overflow does: the console is a debugging utility.
function write(stream, string: string, errorHandler: (err?: Error | null) => void) {
  try {
    // The listener is for an error that the write emits synchronously (files and TTYs on POSIX).
    if (stream.listenerCount("error") === 0) stream.once("error", noop);
    stream.write(string, errorHandler);
  } catch (e) {
    if (
      e != null &&
      typeof e === "object" &&
      (e as Partial<Error>).name === "RangeError" &&
      (e as Partial<Error>).message === "Maximum call stack size exceeded."
    )
      throw e;
  } finally {
    stream.removeListener("error", noop);
  }
}

// For the callback of such a write. An error that `stream` has yet to emit (its _write called back later) gets a listener, so that it is no uncaught exception. Other writes are not affected: the listener goes with the event.
function ignoreWriteError(stream, err: Error | null | undefined) {
  if (err !== null && !stream._writableState.errorEmitted) {
    if (stream.listenerCount("error") === 0) stream.once("error", noop);
  }
}

export default { write, ignoreWriteError };
