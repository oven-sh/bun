// @ts-nocheck
// GENERATED TEMP FILE - DO NOT EDIT
// Sourced from ../../src/js/builtins/ProcessObjectInternals.ts

// do not allow the bundler to rename a symbol to $
($);

$$capture_start$$(function(process,nextTickQueue,drainMicrotasksFn,reportUncaughtExceptionFn) {  var queue;
  var process;
  var nextTickQueue = nextTickQueue;
  var drainMicrotasks = drainMicrotasksFn;
  var reportUncaughtException = reportUncaughtExceptionFn;

  function validateFunction(cb) {
    if (typeof cb !== "function") {
      const err = __intrinsic__makeTypeError(`The "callback" argument must be of type "function". Received type ${typeof cb}`);
      err.code = "ERR_INVALID_ARG_TYPE";
      throw err;
    }
  }

  var setup;
  setup = () => {
    queue = (function createQueue() {
      // Currently optimal queue size, tested on V8 6.0 - 6.6. Must be power of two.
      const kSize = 2048;
      const kMask = kSize - 1;

      // The FixedQueue is implemented as a singly-linked list of fixed-size
      // circular buffers. It looks something like this:
      //
      //  head                                                       tail
      //    |                                                          |
      //    v                                                          v
      // +-----------+ <-----\       +-----------+ <------\         +-----------+
      // |  [null]   |        \----- |   next    |         \------- |   next    |
      // +-----------+               +-----------+                  +-----------+
      // |   item    | <-- bottom    |   item    | <-- bottom       |  [empty]  |
      // |   item    |               |   item    |                  |  [empty]  |
      // |   item    |               |   item    |                  |  [empty]  |
      // |   item    |               |   item    |                  |  [empty]  |
      // |   item    |               |   item    |       bottom --> |   item    |
      // |   item    |               |   item    |                  |   item    |
      // |    ...    |               |    ...    |                  |    ...    |
      // |   item    |               |   item    |                  |   item    |
      // |   item    |               |   item    |                  |   item    |
      // |  [empty]  | <-- top       |   item    |                  |   item    |
      // |  [empty]  |               |   item    |                  |   item    |
      // |  [empty]  |               |  [empty]  | <-- top  top --> |  [empty]  |
      // +-----------+               +-----------+                  +-----------+
      //
      // Or, if there is only one circular buffer, it looks something
      // like either of these:
      //
      //  head   tail                                 head   tail
      //    |     |                                     |     |
      //    v     v                                     v     v
      // +-----------+                               +-----------+
      // |  [null]   |                               |  [null]   |
      // +-----------+                               +-----------+
      // |  [empty]  |                               |   item    |
      // |  [empty]  |                               |   item    |
      // |   item    | <-- bottom            top --> |  [empty]  |
      // |   item    |                               |  [empty]  |
      // |  [empty]  | <-- top            bottom --> |   item    |
      // |  [empty]  |                               |   item    |
      // +-----------+                               +-----------+
      //
      // Adding a value means moving `top` forward by one, removing means
      // moving `bottom` forward by one. After reaching the end, the queue
      // wraps around.
      //
      // When `top === bottom` the current queue is empty and when
      // `top + 1 === bottom` it's full. This wastes a single space of storage
      // but allows much quicker checks.

      class FixedCircularBuffer {
        top: number;
        bottom: number;
        list: Array<FixedCircularBuffer | undefined>;
        next: FixedCircularBuffer | null;

        constructor() {
          this.bottom = 0;
          this.top = 0;
          this.list = __intrinsic__newArrayWithSize(kSize);
          this.next = null;
        }

        isEmpty() {
          return this.top === this.bottom;
        }

        isFull() {
          return ((this.top + 1) & kMask) === this.bottom;
        }

        push(data) {
          this.list[this.top] = data;
          this.top = (this.top + 1) & kMask;
        }

        shift() {
          var { list, bottom } = this;
          const nextItem = list[bottom];
          if (nextItem === undefined) return null;
          list[bottom] = undefined;
          this.bottom = (bottom + 1) & kMask;
          return nextItem;
        }
      }

      class FixedQueue {
        head: FixedCircularBuffer;
        tail: FixedCircularBuffer;

        constructor() {
          this.head = this.tail = new FixedCircularBuffer();
        }

        isEmpty() {
          return this.head.isEmpty();
        }

        push(data) {
          if (this.head.isFull()) {
            // Head is full: Creates a new queue, sets the old queue's `.next` to it,
            // and sets it as the new main queue.
            this.head = this.head.next = new FixedCircularBuffer();
          }
          this.head.push(data);
        }

        shift() {
          const tail = this.tail;
          const next = tail.shift();
          if (tail.isEmpty() && tail.next !== null) {
            // If there is another queue, it forms the new tail.
            this.tail = tail.next;
            tail.next = null;
          }
          return next;
        }
      }

      return new FixedQueue();
    })();

    function processTicksAndRejections() {
      var tock;
      do {
        while ((tock = queue.shift()) !== null) {
          var callback = tock.callback;
          var args = tock.args;
          var frame = tock.frame;
          var restore = __intrinsic__getInternalField(__intrinsic__asyncContext, 0);
          __intrinsic__putInternalField(__intrinsic__asyncContext, 0, frame);
          try {
            if (args === undefined) {
              callback();
            } else {
              switch (args.length) {
                case 1:
                  callback(args[0]);
                  break;
                case 2:
                  callback(args[0], args[1]);
                  break;
                case 3:
                  callback(args[0], args[1], args[2]);
                  break;
                case 4:
                  callback(args[0], args[1], args[2], args[3]);
                  break;
                default:
                  callback(...args);
                  break;
              }
            }
          } catch (e) {
            reportUncaughtException(e);
          } finally {
            __intrinsic__putInternalField(__intrinsic__asyncContext, 0, restore);
          }
        }

        drainMicrotasks();
      } while (!queue.isEmpty());
    }

    __intrinsic__putInternalField(nextTickQueue, 0, 0);
    __intrinsic__putInternalField(nextTickQueue, 1, queue);
    __intrinsic__putInternalField(nextTickQueue, 2, processTicksAndRejections);
    setup = undefined;
  };

  function nextTick(cb, args) {
    validateFunction(cb);
    if (setup) {
      setup();
      process = globalThis.process;
    }
    if (process._exiting) return;

    queue.push({
      callback: cb,
      args: __intrinsic__argumentCount() > 1 ? Array.prototype.slice.__intrinsic__call(arguments, 1) : undefined,
      frame: __intrinsic__getInternalField(__intrinsic__asyncContext, 0),
    });
    __intrinsic__putInternalField(nextTickQueue, 0, 1);
  }

  return nextTick;
}).$$capture_end$$;
