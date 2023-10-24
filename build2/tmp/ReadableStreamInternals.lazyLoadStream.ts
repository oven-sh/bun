// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(stream,autoAllocateChunkSize) {  var nativeType = __intrinsic__getByIdDirectPrivate(stream, "bunNativeType");
  var nativePtr = __intrinsic__getByIdDirectPrivate(stream, "bunNativePtr");
  var Prototype = __intrinsic__lazyStreamPrototypeMap.__intrinsic__get(nativeType);
  if (Prototype === undefined) {
    var [pull, start, cancel, setClose, deinit, setRefOrUnref, drain] = __intrinsic__lazy(nativeType);
    var closer = [false];
    var handleResult;
    function handleNativeReadableStreamPromiseResult(val) {
      var { c, v } = this;
      this.c = undefined;
      this.v = undefined;
      handleResult(val, c, v);
    }

    function callClose(controller) {
      try {
        if (
          __intrinsic__getByIdDirectPrivate(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"), "state") ===
          __intrinsic__streamReadable
        ) {
          controller.close();
        }
      } catch (e) {
        globalThis.reportError(e);
      }
    }

    handleResult = function handleResult(result, controller, view) {
      if (result && __intrinsic__isPromise(result)) {
        return result.then(
          handleNativeReadableStreamPromiseResult.bind({
            c: controller,
            v: view,
          }),
          err => controller.error(err),
        );
      } else if (typeof result === "number") {
        if (view && view.byteLength === result && view.buffer === controller.byobRequest?.view?.buffer) {
          controller.byobRequest.respondWithNewView(view);
        } else {
          controller.byobRequest.respond(result);
        }
      } else if (result.constructor === __intrinsic__Uint8Array) {
        controller.enqueue(result);
      }

      if (closer[0] || result === false) {
        __intrinsic__enqueueJob(callClose, controller);
        closer[0] = false;
      }
    };

    function createResult(tag, controller, view, closer) {
      closer[0] = false;

      var result;
      try {
        result = pull(tag, view, closer);
      } catch (err) {
        return controller.error(err);
      }

      return handleResult(result, controller, view);
    }

    const registry = deinit ? new FinalizationRegistry(deinit) : null;
    Prototype = class NativeReadableStreamSource {
      constructor(tag, autoAllocateChunkSize, drainValue) {
        this.#tag = tag;
        this.#cancellationToken = {};
        this.pull = this.#pull.bind(this);
        this.cancel = this.#cancel.bind(this);
        this.autoAllocateChunkSize = autoAllocateChunkSize;

        if (drainValue !== undefined) {
          this.start = controller => {
            controller.enqueue(drainValue);
          };
        }

        if (registry) {
          registry.register(this, tag, this.#cancellationToken);
        }
      }

      #cancellationToken;
      pull;
      cancel;
      start;

      #tag;
      type = "bytes";
      autoAllocateChunkSize = 0;

      static startSync = start;

      #pull(controller) {
        var tag = this.#tag;

        if (!tag) {
          controller.close();
          return;
        }

        createResult(tag, controller, controller.byobRequest.view, closer);
      }

      #cancel(reason) {
        var tag = this.#tag;

        registry && registry.unregister(this.#cancellationToken);
        setRefOrUnref && setRefOrUnref(tag, false);
        cancel(tag, reason);
      }
      static deinit = deinit;
      static drain = drain;
    };
    __intrinsic__lazyStreamPrototypeMap.__intrinsic__set(nativeType, Prototype);
  }

  const chunkSize = Prototype.startSync(nativePtr, autoAllocateChunkSize);
  var drainValue;
  const { drain: drainFn, deinit: deinitFn } = Prototype;
  if (drainFn) {
    drainValue = drainFn(nativePtr);
  }

  // empty file, no need for native back-and-forth on this
  if (chunkSize === 0) {
    deinit && nativePtr && __intrinsic__enqueueJob(deinit, nativePtr);

    if ((drainValue?.byteLength ?? 0) > 0) {
      return {
        start(controller) {
          controller.enqueue(drainValue);
          controller.close();
        },
        type: "bytes",
      };
    }

    return {
      start(controller) {
        controller.close();
      },
      type: "bytes",
    };
  }

  return new Prototype(nativePtr, chunkSize, drainValue);
}).$$capture_end$$;
