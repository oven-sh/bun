// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ReadableStreamDefaultReader.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function() {  if (!__intrinsic__isReadableStreamDefaultReader(this))
    __intrinsic__throwTypeError("ReadableStreamDefaultReader.readMany() should not be called directly");

  const stream = __intrinsic__getByIdDirectPrivate(this, "ownerReadableStream");
  if (!stream) __intrinsic__throwTypeError("readMany() called on a reader owned by no readable stream");

  const state = __intrinsic__getByIdDirectPrivate(stream, "state");
  __intrinsic__putByIdDirectPrivate(stream, "disturbed", true);
  if (state === __intrinsic__streamClosed) return { value: [], size: 0, done: true };
  else if (state === __intrinsic__streamErrored) {
    throw __intrinsic__getByIdDirectPrivate(stream, "storedError");
  }

  var controller = __intrinsic__getByIdDirectPrivate(stream, "readableStreamController");
  var queue = __intrinsic__getByIdDirectPrivate(controller, "queue");
  if (!queue) {
    // This is a ReadableStream direct controller implemented in JS
    // It hasn't been started yet.
    return controller.__intrinsic__pull(controller).__intrinsic__then(function ({ done, value }) {
      return done ? { done: true, value: [], size: 0 } : { value: [value], size: 1, done: false };
    });
  }

  const content = queue.content;
  var size = queue.size;
  var values = content.toArray(false);

  var length = values.length;

  if (length > 0) {
    var outValues = __intrinsic__newArrayWithSize(length);
    if (__intrinsic__isReadableByteStreamController(controller)) {
      {
        const buf = values[0];
        if (!(ArrayBuffer.__intrinsic__isView(buf) || buf instanceof ArrayBuffer)) {
          __intrinsic__putByValDirect(outValues, 0, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          __intrinsic__putByValDirect(outValues, 0, buf);
        }
      }

      for (var i = 1; i < length; i++) {
        const buf = values[i];
        if (!(ArrayBuffer.__intrinsic__isView(buf) || buf instanceof ArrayBuffer)) {
          __intrinsic__putByValDirect(outValues, i, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
        } else {
          __intrinsic__putByValDirect(outValues, i, buf);
        }
      }
    } else {
      __intrinsic__putByValDirect(outValues, 0, values[0].value);
      for (var i = 1; i < length; i++) {
        __intrinsic__putByValDirect(outValues, i, values[i].value);
      }
    }

    __intrinsic__resetQueue(__intrinsic__getByIdDirectPrivate(controller, "queue"));

    if (__intrinsic__getByIdDirectPrivate(controller, "closeRequested"))
      __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
    else if (__intrinsic__isReadableStreamDefaultController(controller)) {
      __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
    } else if (__intrinsic__isReadableByteStreamController(controller)) {
      __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
    }

    return { value: outValues, size, done: false };
  }

  var onPullMany = result => {
    if (result.done) {
      return { value: [], size: 0, done: true };
    }
    var controller = __intrinsic__getByIdDirectPrivate(stream, "readableStreamController");

    var queue = __intrinsic__getByIdDirectPrivate(controller, "queue");
    var value = [result.value].concat(queue.content.toArray(false));
    var length = value.length;

    if (__intrinsic__isReadableByteStreamController(controller)) {
      for (var i = 0; i < length; i++) {
        const buf = value[i];
        if (!(ArrayBuffer.__intrinsic__isView(buf) || buf instanceof ArrayBuffer)) {
          const { buffer, byteOffset, byteLength } = buf;
          __intrinsic__putByValDirect(value, i, new Uint8Array(buffer, byteOffset, byteLength));
        }
      }
    } else {
      for (var i = 1; i < length; i++) {
        __intrinsic__putByValDirect(value, i, value[i].value);
      }
    }

    var size = queue.size;
    __intrinsic__resetQueue(queue);

    if (__intrinsic__getByIdDirectPrivate(controller, "closeRequested")) {
      __intrinsic__readableStreamClose(__intrinsic__getByIdDirectPrivate(controller, "controlledReadableStream"));
    } else if (__intrinsic__isReadableStreamDefaultController(controller)) {
      __intrinsic__readableStreamDefaultControllerCallPullIfNeeded(controller);
    } else if (__intrinsic__isReadableByteStreamController(controller)) {
      __intrinsic__readableByteStreamControllerCallPullIfNeeded(controller);
    }

    return { value: value, size: size, done: false };
  };

  var pullResult = controller.__intrinsic__pull(controller);
  if (pullResult && __intrinsic__isPromise(pullResult)) {
    return pullResult.__intrinsic__then(onPullMany) as any;
  }

  return onPullMany(pullResult);
}).$$capture_end$$;
