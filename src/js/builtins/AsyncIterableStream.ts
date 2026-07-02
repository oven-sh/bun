// Converts an async iterable (or the result of an async generator function) into the
// direct ReadableStream that Bun's Response/Request body extension expects: `yield`
// evaluates to the direct controller, writes respect the sink's backpressure protocol,
// and cancellation is forwarded to the iterator via throw()/return().
export function readableStreamFromAsyncIterator(target, fn) {
  var cancelled = false,
    iter: AsyncIterator<any>;

  // We must eagerly start the async generator to ensure that it works if objects are reused later.
  // This impacts Astro, amongst others.
  iter = fn.$call(target);
  fn = target = undefined;

  if (typeof iter.next !== "function") {
    throw new TypeError("Expected an async generator");
  }

  var runningAsyncIteratorPromise;
  async function runAsyncIterator(controller) {
    var closingError: Error | undefined, value, done, immediateTask;

    try {
      while (!cancelled && !done) {
        const promise = iter.next(controller);

        if (cancelled) {
          return;
        }

        if ($isPromise(promise) && $peekPromiseStatus(promise) === 1) {
          clearImmediate(immediateTask);
          ({ value, done } = $peekPromiseSettledValue(promise));
          $assert(!$isPromise(value), "Expected a value, not a promise");
        } else {
          immediateTask = setImmediate(() => immediateTask && controller?.flush?.(true));
          ({ value, done } = await promise);

          if (cancelled) {
            return;
          }
        }

        if (!$isUndefinedOrNull(value)) {
          // See readStreamIntoSink: the HTTP response sink returns a negative
          // number when the socket is backed up; await the drain via
          // flush(true). FileSink's Promise return is intentionally not
          // awaited here, so mark it handled.
          const wrote = controller.write(value);
          if (wrote < 0) {
            clearImmediate(immediateTask);
            immediateTask = undefined;
            await controller.flush(true);
          } else if ($isPromise(wrote)) {
            $markPromiseAsHandled(wrote);
          }
        }
      }
    } catch (e) {
      closingError = e;
    } finally {
      clearImmediate(immediateTask);
      immediateTask = undefined;
      // "iter" will be undefined if the stream was closed above.

      // Stream was closed before we tried writing to it.
      if (closingError?.code === "ERR_INVALID_THIS") {
        await iter?.return?.();
        return;
      }

      if (closingError) {
        try {
          await iter.throw?.(closingError);
        } catch {
          // The iterator's own cleanup failure is subsumed by the original error.
        } finally {
          iter = undefined;
        }
        throw closingError;
      } else {
        await controller.end();
        if (iter) {
          await iter.return?.();
        }
      }
      iter = undefined;
    }
  }

  return new ReadableStream({
    type: "direct",

    cancel(reason) {
      $debug("readableStreamFromAsyncIterator.cancel", reason);
      cancelled = true;

      if (iter) {
        const thisIter = iter;
        iter = undefined;
        if (reason) {
          // We return the value so that the caller can await it.
          return thisIter.throw?.(reason);
        } else {
          // undefined === Abort.
          //
          // We don't want to throw here because it will almost
          // inevitably become an uncatchable exception. So instead, we call the
          // synthetic return method if it exists to signal that the stream is
          // done.
          return thisIter?.return?.();
        }
      }
    },

    close() {
      cancelled = true;
    },

    async pull(controller) {
      // pull() may be called multiple times before a single call completes.
      //
      // But, we only call into the stream once while a stream is in-progress.
      if (!runningAsyncIteratorPromise) {
        const asyncIteratorPromise = runAsyncIterator(controller);
        runningAsyncIteratorPromise = asyncIteratorPromise;
        try {
          const result = await asyncIteratorPromise;
          return result;
        } catch (e) {
          // The consumer is already gone (the sink closed underneath the
          // iterator loop), so swallow the "controller is closed" error
          // instead of surfacing it as an unhandled rejection.
          if (cancelled || (e as any)?.code === "ERR_INVALID_STATE") return;
          throw e;
        } finally {
          if (runningAsyncIteratorPromise === asyncIteratorPromise) {
            runningAsyncIteratorPromise = undefined;
          }
        }
      }

      return runningAsyncIteratorPromise;
    },
  });
}
