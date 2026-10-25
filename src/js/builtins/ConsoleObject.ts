$overriddenName = "[Symbol.asyncIterator]";
export function asyncIterator(this: Console) {
  var stream: ReadableStream<Uint8Array> = Bun.stdin.stream();

  var decoder = new TextDecoder("utf-8", { fatal: false });
  var indexOf: (buffer: Uint8Array, offset: number) => number = Bun.indexOfLine;
  var actualChunk: Uint8Array;
  var i: number = -1;
  var idx: number;
  var last: number;
  var done: boolean;
  var value: Uint8Array[];
  var value_len: number;
  var pendingChunk: Uint8Array | undefined;

  async function* ConsoleAsyncIterator() {
    var reader = stream.getReader();
    var deferredError: Error | undefined;
    try {
      if (i !== -1) {
        last = i + 1;
        i = indexOf(actualChunk, last);

        while (i !== -1) {
          yield decoder.decode(actualChunk.subarray(last, i));
          last = i + 1;
          i = indexOf(actualChunk, last);
        }

        for (idx++; idx < value_len; idx++) {
          actualChunk = value[idx];
          if (pendingChunk) {
            actualChunk = Buffer.concat([pendingChunk, actualChunk]);
            pendingChunk = undefined;
          }

          last = 0;
          // TODO: "\r", 0x4048, 0x4049, 0x404A, 0x404B, 0x404C, 0x404D, 0x404E, 0x404F
          i = indexOf(actualChunk, last);
          while (i !== -1) {
            yield decoder.decode(
              actualChunk.subarray(
                last,
                process.platform === "win32" ? (actualChunk[i - 1] === 0x0d /* \r */ ? i - 1 : i) : i,
              ),
            );
            last = i + 1;
            i = indexOf(actualChunk, last);
          }
          i = -1;

          pendingChunk = actualChunk.subarray(last);
        }
        actualChunk = undefined!;
      }

      while (true) {
        const firstResult = reader.readMany();
        if ($isPromise(firstResult)) {
          ({ done, value } = await firstResult);
        } else {
          ({ done, value } = firstResult);
        }

        if (done) {
          if (pendingChunk) {
            yield decoder.decode(pendingChunk);
          }
          return;
        }

        // we assume it was given line-by-line
        for (idx = 0, value_len = value.length; idx < value_len; idx++) {
          actualChunk = value[idx];
          if (pendingChunk) {
            actualChunk = Buffer.concat([pendingChunk, actualChunk]);
            pendingChunk = undefined;
          }

          last = 0;
          // TODO: "\r", 0x4048, 0x4049, 0x404A, 0x404B, 0x404C, 0x404D, 0x404E, 0x404F
          i = indexOf(actualChunk, last);
          while (i !== -1) {
            // This yield may end the function, in that case we need to be able to recover state
            // if the iterator was fired up again.
            yield decoder.decode(
              actualChunk.subarray(
                last,
                process.platform === "win32" ? (actualChunk[i - 1] === 0x0d /* \r */ ? i - 1 : i) : i,
              ),
            );
            last = i + 1;
            i = indexOf(actualChunk, last);
          }
          i = -1;

          pendingChunk = actualChunk.subarray(last);
        }
        actualChunk = undefined!;
      }
    } catch (e) {
      deferredError = e as Error;
    } finally {
      reader.releaseLock();
    }

    if (deferredError) {
      // eslint-disable-next-line no-throw-literal
      throw deferredError;
    }
  }

  const symbol = globalThis.Symbol.asyncIterator;
  this[symbol] = ConsoleAsyncIterator;
  return ConsoleAsyncIterator();
}

type ConsoleWriteInput = string | ArrayBufferView | ArrayBuffer | SharedArrayBuffer;

export function write(this: Console & { $writer: $Node.FileSink | undefined }, input: ConsoleWriteInput) {
  if (!$isObject(this)) throw $ERR_INVALID_THIS("Console");

  var writer: $Node.FileSink | undefined = $getByIdDirectPrivate(this, "writer");
  if (!writer) {
    var length = $toLength((input as string | Uint8Array)?.length ?? 0);
    writer = Bun.stdout.writer({ highWaterMark: length > 65536 ? length : 65536 }) as $Node.FileSink;
    $putByIdDirectPrivate(this, "writer", writer);
  }

  var wrote = writer.write(input) as number;

  const count = $argumentCount();
  for (var i = 1; i < count; i++) {
    wrote += writer.write(arguments[i]) as number;
  }

  writer.flush(true);
  return wrote;
}

// This is the `console.Console` constructor. It is mostly copied from Node.
// https://github.com/nodejs/node/blob/d2c7c367741bdcb6f7f77f55ce95a745f0b29fef/lib/internal/console/constructor.js
// Some parts are copied from imported files and inlined here. Not too much of a performance issue
// to do extra work at startup, since most people do not need `console.Console`.
// TODO: probably could extract `getStringWidth`; probably make that a native function. note how it is copied from `readline.js`
export function createConsoleConstructor(console: Console) {
  const { inspect, formatWithOptions } = require("node:util");
  const { isBuffer }: { isBuffer(value: unknown): boolean } = require("node:buffer").Buffer;
  const { isMapIterator, isSetIterator } = require("node:util/types");

  const { validateObject, validateInteger, validateArray, validateOneOf } = require("internal/validators");
  const kMaxGroupIndentation = 1000;

  const StringPrototypeIncludes = String.prototype.includes;
  const RegExpPrototypeSymbolReplace: (this: RegExp, string: string, replaceValue: string) => string =
    RegExp.prototype[Symbol.replace];
  const ArrayPrototypeUnshift = Array.prototype.unshift;
  const StringPrototypeRepeat = String.prototype.repeat;
  const StringPrototypeSlice = String.prototype.slice;
  const StringPrototypeStartsWith = String.prototype.startsWith;
  const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
  const ArrayPrototypeMap = Array.prototype.map;
  const ArrayPrototypeJoin = Array.prototype.join;
  const ArrayPrototypePush = Array.prototype.push;

  const kCounts = Symbol("counts");

  const internalGetStringWidth: (input: string, options?: unknown) => number = $newCppFunction(
    "stringWidth.cpp",
    "jsFunctionBunStringWidth",
    1,
  );

  /**
   * Returns the number of columns required to display the given string.
   */
  var getStringWidth = function getStringWidth(str: string, removeControlChars = true) {
    return internalGetStringWidth(str, removeControlChars);
  };

  const tableChars = {
    middleMiddle: "─",
    rowMiddle: "┼",
    topRight: "┐",
    topLeft: "┌",
    leftMiddle: "├",
    topMiddle: "┬",
    bottomRight: "┘",
    bottomLeft: "└",
    bottomMiddle: "┴",
    rightMiddle: "┤",
    left: "│ ",
    right: " │",
    middle: " │ ",
  };

  const renderRow = (row: string[], columnWidths: number[]) => {
    let out = tableChars.left;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      const len = getStringWidth(cell);
      const needed = (columnWidths[i] - len) / 2;
      // round(needed) + ceil(needed) will always add up to the amount
      // of spaces we need while also left justifying the output.
      out += StringPrototypeRepeat.$call(" ", needed) + cell + StringPrototypeRepeat.$call(" ", Math.ceil(needed));
      if (i !== row.length - 1) out += tableChars.middle;
    }
    out += tableChars.right;
    return out;
  };

  const table = (head: string[], columns: string[][]) => {
    const columnWidths = ArrayPrototypeMap.$call(head, h => getStringWidth(h)) as number[];
    const longestColumn = Math.max(...(ArrayPrototypeMap.$call(columns, a => a.length) as number[]));
    const rows: string[][] = $newArrayWithSize(longestColumn);

    for (let i = 0; i < head.length; i++) {
      const column = columns[i];
      for (let j = 0; j < longestColumn; j++) {
        if (rows[j] === undefined) rows[j] = [];
        const value = (rows[j][i] = ObjectPrototypeHasOwnProperty.$call(column, j) ? column[j] : "");
        const width = columnWidths[i] || 0;
        const counted = getStringWidth(value);
        columnWidths[i] = Math.max(width, counted);
      }
    }

    const divider = ArrayPrototypeMap.$call(columnWidths, i =>
      StringPrototypeRepeat.$call(tableChars.middleMiddle, i + 2),
    );

    let result =
      tableChars.topLeft +
      ArrayPrototypeJoin.$call(divider, tableChars.topMiddle) +
      tableChars.topRight +
      "\n" +
      renderRow(head, columnWidths) +
      "\n" +
      tableChars.leftMiddle +
      ArrayPrototypeJoin.$call(divider, tableChars.rowMiddle) +
      tableChars.rightMiddle +
      "\n";

    for (const row of rows) result += `${renderRow(row, columnWidths)}\n`;

    result +=
      tableChars.bottomLeft + ArrayPrototypeJoin.$call(divider, tableChars.bottomMiddle) + tableChars.bottomRight;

    return result;
  };

  // Track amount of indentation required via `console.group()`.
  const kGroupIndent = Symbol("kGroupIndent");
  const kGroupIndentationWidth = Symbol("kGroupIndentWidth");
  const kFormatForStderr = Symbol("kFormatForStderr");
  const kFormatForStdout = Symbol("kFormatForStdout");
  const kGetInspectOptions = Symbol("kGetInspectOptions");
  const kColorMode = Symbol("kColorMode");
  const kIsConsole = Symbol("kIsConsole");
  const kWriteToConsole = Symbol("kWriteToConsole");
  const kBindProperties = Symbol("kBindProperties");
  const kBindStreamsEager = Symbol("kBindStreamsEager");
  const kBindStreamsLazy = Symbol("kBindStreamsLazy");
  const kUseStdout = Symbol("kUseStdout");
  const kUseStderr = Symbol("kUseStderr");

  type StreamSymbol = typeof kUseStdout | typeof kUseStderr;
  type ColorMode = "auto" | boolean;

  interface ConsoleStream extends $Node.Writable {
    isTTY?: boolean;
    getColorDepth?(): number;
  }

  /** The options of `util.inspect`. */
  interface ConsoleInspectOptions {
    colors?: boolean;
  }

  interface ConsoleOptions {
    stdout: ConsoleStream;
    stderr?: ConsoleStream;
    ignoreErrors?: boolean;
    colorMode?: ColorMode;
    inspectOptions?: ConsoleInspectOptions | Map<ConsoleStream, ConsoleInspectOptions>;
    groupIndentation?: number;
    /** A stream has it: `new Console(stdout, stderr, ignoreErrors)`. */
    write?: undefined;
  }

  interface ConsolePrototype {
    [kBindStreamsEager](this: ConsoleInstance, stdout: ConsoleStream, stderr: ConsoleStream): void;
    [kBindStreamsLazy](this: ConsoleInstance, object: { stdout: ConsoleStream; stderr: ConsoleStream }): void;
    [kBindProperties](
      this: ConsoleInstance,
      ignoreErrors: boolean,
      colorMode: ColorMode,
      groupIndentation?: number,
    ): void;
    [kWriteToConsole](this: ConsoleInstance, streamSymbol: StreamSymbol, string: string): boolean | undefined;
    [kGetInspectOptions](this: ConsoleInstance, stream: ConsoleStream): ConsoleInspectOptions;
    [kFormatForStdout](this: ConsoleInstance, args: unknown[]): string;
    [kFormatForStderr](this: ConsoleInstance, args: unknown[]): string;
    log(this: ConsoleInstance, ...args: unknown[]): void;
    debug(this: ConsoleInstance, ...args: unknown[]): void;
    info(this: ConsoleInstance, ...args: unknown[]): void;
    dirxml(this: ConsoleInstance, ...args: unknown[]): void;
    warn(this: ConsoleInstance, ...args: unknown[]): void;
    error(this: ConsoleInstance, ...args: unknown[]): void;
    group(this: ConsoleInstance, ...data: unknown[]): void;
    groupCollapsed(this: ConsoleInstance, ...data: unknown[]): void;
  }

  interface ConsoleInstance extends ConsolePrototype {
    _stdout: ConsoleStream;
    _stderr: ConsoleStream;
    _stdoutErrorHandler: $Node.ErrorCallback;
    _stderrErrorHandler: $Node.ErrorCallback;
    _ignoreErrors: boolean;
    _times: Map<string, [number, number]>;
    [kCounts]: Map<string, number>;
    [kColorMode]: ColorMode;
    [kIsConsole]: true;
    [kGroupIndent]: string;
    [kGroupIndentationWidth]: number;
  }

  const optionsMap = new WeakMap<ConsoleInstance, NonNullable<ConsoleOptions["inspectOptions"]>>();
  function Console(this: ConsoleInstance, ...args: any[]): void;
  function Console(
    this: ConsoleInstance,
    options: ConsoleOptions | ConsoleStream /* or: stdout, stderr, ignoreErrors = true */,
  ): void {
    // We have to test new.target here to see if this function is called
    // with new, because we need to define a custom instanceof to accommodate
    // the global console.
    if (new.target === undefined) return new Console(...arguments);

    if (!options || typeof options.write === "function") {
      options = {
        stdout: options,
        stderr: arguments[1],
        ignoreErrors: arguments[2],
      };
    }

    const {
      stdout,
      stderr = stdout,
      ignoreErrors = true,
      colorMode = "auto",
      inspectOptions,
      groupIndentation,
    } = options;

    if (!stdout || typeof stdout.write !== "function") {
      throw $ERR_CONSOLE_WRITABLE_STREAM("stdout is not a writable stream");
    }
    if (!stderr || typeof stderr.write !== "function") {
      throw $ERR_CONSOLE_WRITABLE_STREAM("stderr is not a writable stream");
    }

    validateOneOf(colorMode, "colorMode", ["auto", true, false]);

    if (groupIndentation !== undefined) {
      validateInteger(groupIndentation, "groupIndentation", 0, kMaxGroupIndentation);
    }

    if (inspectOptions !== undefined) {
      validateObject(inspectOptions, "options.inspectOptions");

      // inspectOptions may be a Map keyed by stream, giving each stream its own
      // options; a plain object applies to both.
      const isPerStream = $isMap(inspectOptions);
      for (const stream of [stdout, stderr]) {
        const perStreamOptions = isPerStream ? inspectOptions.$get(stream) : inspectOptions;
        if (perStreamOptions?.colors !== undefined && options.colorMode !== undefined) {
          throw $ERR_INCOMPATIBLE_OPTION_PAIR(
            'Option "options.inspectOptions.color" cannot be used in combination with option "colorMode"',
          );
        }
      }
      optionsMap.set(this, inspectOptions);
    }

    // Bind the prototype functions to this Console instance
    Object.keys(Console.prototype).forEach(key => {
      // We have to bind the methods grabbed from the instance instead of from
      // the prototype so that users extending the Console can override them
      // from the prototype chain of the subclass.
      this[key] = this[key].bind(this);
      Object.defineProperty(this[key], "name", {
        value: key,
      });
    });

    this[kBindStreamsEager](stdout, stderr);
    this[kBindProperties](ignoreErrors, colorMode, groupIndentation);
  }

  const consolePropAttributes = {
    writable: true,
    enumerable: false,
    configurable: true,
  };

  // Fixup global.console instanceof global.console.Console
  Object.defineProperty(Console, Symbol.hasInstance, {
    value(instance: ConsoleInstance | Console) {
      return instance[kIsConsole] || instance === console;
    },
  });

  const kColorInspectOptions = { colors: true };
  const kNoColorInspectOptions = {};

  Object.defineProperties((Console.prototype = {} as ConsolePrototype), {
    [kBindStreamsEager]: {
      ...consolePropAttributes,
      // Eager version for the Console constructor
      value: function (this: ConsoleInstance, stdout: ConsoleStream, stderr: ConsoleStream) {
        Object.defineProperties(this, {
          "_stdout": { ...consolePropAttributes, value: stdout },
          "_stderr": { ...consolePropAttributes, value: stderr },
        });
      },
    },
    [kBindStreamsLazy]: {
      ...consolePropAttributes,
      // Lazily load the stdout and stderr from an object so we don't
      // create the stdio streams when they are not even accessed
      value: function (this: ConsoleInstance, object: { stdout: ConsoleStream; stderr: ConsoleStream }) {
        let stdout: ConsoleStream | undefined;
        let stderr: ConsoleStream | undefined;
        Object.defineProperties(this, {
          "_stdout": {
            enumerable: false,
            configurable: true,
            get() {
              if (!stdout) stdout = object.stdout;
              return stdout;
            },
            set(value: ConsoleStream) {
              stdout = value;
            },
          },
          "_stderr": {
            enumerable: false,
            configurable: true,
            get() {
              if (!stderr) {
                stderr = object.stderr;
              }
              return stderr;
            },
            set(value: ConsoleStream) {
              stderr = value;
            },
          },
        });
      },
    },
    [kBindProperties]: {
      ...consolePropAttributes,
      value: function (this: ConsoleInstance, ignoreErrors: boolean, colorMode: ColorMode, groupIndentation = 2) {
        Object.defineProperties(this, {
          "_stdoutErrorHandler": {
            ...consolePropAttributes,
            value: createWriteErrorHandler(this, kUseStdout),
          },
          "_stderrErrorHandler": {
            ...consolePropAttributes,
            value: createWriteErrorHandler(this, kUseStderr),
          },
          "_ignoreErrors": {
            ...consolePropAttributes,
            value: Boolean(ignoreErrors),
          },
          "_times": { ...consolePropAttributes, value: new Map() },
          // Corresponds to https://console.spec.whatwg.org/#count-map
          [kCounts]: { ...consolePropAttributes, value: new Map() },
          [kColorMode]: { ...consolePropAttributes, value: colorMode },
          [kIsConsole]: { ...consolePropAttributes, value: true },
          [kGroupIndent]: { ...consolePropAttributes, value: "" },
          [kGroupIndentationWidth]: {
            ...consolePropAttributes,
            value: groupIndentation,
          },
          [Symbol.toStringTag]: {
            writable: false,
            enumerable: false,
            configurable: true,
            value: "console",
          },
        });
      },
    },
    [kWriteToConsole]: {
      ...consolePropAttributes,
      value: function (this: ConsoleInstance, streamSymbol: StreamSymbol, string: string) {
        const ignoreErrors = this._ignoreErrors;
        const groupIndent = this[kGroupIndent];

        const useStdout = streamSymbol === kUseStdout;
        const stream = useStdout ? this._stdout : this._stderr;
        const errorHandler = useStdout ? this._stdoutErrorHandler : this._stderrErrorHandler;

        if (groupIndent.length !== 0) {
          if (StringPrototypeIncludes.$call(string, "\n")) {
            // ?!
            string = RegExpPrototypeSymbolReplace.$call(/\n/g, string, `\n${groupIndent}`);
          }
          string = groupIndent + string;
        }
        string += "\n";

        if (ignoreErrors === false) return stream.write(string);

        // There may be an error occurring synchronously (e.g. for files or TTYs
        // on POSIX systems) or asynchronously (e.g. pipes on POSIX systems), so
        // handle both situations.
        let lengthBefore: number | undefined;
        try {
          lengthBefore = stream.writableLength;
          // Add and later remove a noop error handler to catch synchronous
          // errors.
          if (stream.listenerCount("error") === 0) stream.once("error", noop);
          stream.write(string, errorHandler);
        } catch (e) {
          if (e != null && typeof e === "object" && (e as Partial<Error>).name === "RangeError") {
            const message = (e as Partial<Error>).message;
            // Console is a debugging utility, so it swallowing errors is not
            // desirable even in edge cases such as low stack space.
            if (message === "Maximum call stack size exceeded.") throw e;
            // Some memory is free again once an out-of-memory error has been thrown.
            // Write once more if the stream has not taken the text.
            if (typeof message === "string" && StringPrototypeStartsWith.$call(message, "Out of memory")) {
              try {
                if (stream.writableLength === (lengthBefore ?? stream.writableLength)) {
                  if (stream.listenerCount("error") === 0) stream.once("error", noop);
                  stream.write(string, errorHandler);
                }
              } catch {}
            }
          }
          // Sorry, there's no proper way to pass along the error here.
        } finally {
          stream.removeListener("error", noop);
        }
      },
    },
    [kGetInspectOptions]: {
      ...consolePropAttributes,
      value: function (this: ConsoleInstance, stream: ConsoleStream) {
        let color: ColorMode | undefined = this[kColorMode];
        if (color === "auto") {
          if (Bun.env["FORCE_COLOR"] !== undefined) {
            color = Bun.enableANSIColors;
          } else {
            color = stream.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
          }
        }

        const inspectOptions = optionsMap.get(this);
        const options = $isMap(inspectOptions) ? inspectOptions.$get(stream) : inspectOptions;
        if (options) {
          if (options.colors === undefined) {
            options.colors = color as boolean | undefined;
          }
          return options;
        }

        return color ? kColorInspectOptions : kNoColorInspectOptions;
      },
    },
    [kFormatForStdout]: {
      ...consolePropAttributes,
      value: function (this: ConsoleInstance, args: unknown[]) {
        const opts = this[kGetInspectOptions](this._stdout);
        return formatWithOptions(opts, ...args);
      },
    },
    [kFormatForStderr]: {
      ...consolePropAttributes,
      value: function (this: ConsoleInstance, args: unknown[]) {
        const opts = this[kGetInspectOptions](this._stderr);
        return formatWithOptions(opts, ...args);
      },
    },
  });

  // Make a function that can serve as the callback passed to `stream.write()`.
  function createWriteErrorHandler(instance: ConsoleInstance, streamSymbol: StreamSymbol): $Node.ErrorCallback {
    return err => {
      // This conditional evaluates to true if and only if there was an error
      // that was not already emitted (which happens when the _write callback
      // is invoked asynchronously).
      const stream = streamSymbol === kUseStdout ? instance._stdout : instance._stderr;
      if (err !== null && !stream._writableState.errorEmitted) {
        // If there was an error, it will be emitted on `stream` as
        // an `error` event. Adding a `once` listener will keep that error
        // from becoming an uncaught exception, but since the handler is
        // removed after the event, non-console.* writes won't be affected.
        // we are only adding noop if there is no one else listening for 'error'
        if (stream.listenerCount("error") === 0) {
          stream.once("error", noop);
        }
      }
    };
  }

  const consoleMethods = {
    log(this: ConsoleInstance, ...args: unknown[]) {
      this[kWriteToConsole](kUseStdout, this[kFormatForStdout](args));
    },

    warn(this: ConsoleInstance, ...args: unknown[]) {
      this[kWriteToConsole](kUseStderr, this[kFormatForStderr](args));
    },

    dir(this: ConsoleInstance, object: unknown, options?: ConsoleInspectOptions) {
      this[kWriteToConsole](
        kUseStdout,
        inspect(object, {
          customInspect: false,
          ...this[kGetInspectOptions](this._stdout),
          ...options,
        }),
      );
    },

    time(this: ConsoleInstance, label = "default") {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      if (this._times.has(label)) {
        process.emitWarning(`Label '${label}' already exists for console.time()`);
        return;
      }
      // trace(kTraceBegin, kTraceConsoleCategory, `time::${label}`, 0);
      this._times.set(label, process.hrtime());
    },

    timeEnd(this: ConsoleInstance, label = "default") {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      const found = timeLogImpl(this, "timeEnd", label);
      // trace(kTraceEnd, kTraceConsoleCategory, `time::${label}`, 0);
      if (found) {
        this._times.delete(label);
      }
    },

    timeLog(this: ConsoleInstance, label = "default", ...data: unknown[]) {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      timeLogImpl(this, "timeLog", label, data);
      // trace(kTraceInstant, kTraceConsoleCategory, `time::${label}`, 0);
    },

    trace: function trace(this: ConsoleInstance, ...args: unknown[]) {
      const err: Error = {
        name: "Trace",
        message: this[kFormatForStderr](args),
      };
      Error.captureStackTrace(err, trace);
      this.error(err.stack);
    },

    assert(this: ConsoleInstance, expression: unknown, ...args: unknown[]) {
      if (!expression) {
        args[0] = `Assertion failed${args.length === 0 ? "" : `: ${args[0]}`}`;
        // The arguments will be formatted in warn() again
        this.warn.$apply(this, args);
      }
    },

    // Defined by: https://console.spec.whatwg.org/#clear
    clear(this: ConsoleInstance) {
      // It only makes sense to clear if _stdout is a TTY.
      // Otherwise, do nothing.
      if (this._stdout.isTTY && Bun.env["TERM"] !== "dumb") {
        this._stdout.write("\x1B[2J\x1B[3J\x1B[H");
      }
    },

    // Defined by: https://console.spec.whatwg.org/#count
    count(this: ConsoleInstance, label = "default") {
      // Ensures that label is a string, and only things that can be
      // coerced to strings. e.g. Symbol is not allowed
      label = `${label}`;
      const counts = this[kCounts];
      let count = counts.get(label);
      if (count === undefined) count = 1;
      else count++;
      counts.set(label, count);
      // trace(kTraceCount, kTraceConsoleCategory, `count::${label}`, 0, count);
      this.log(`${label}: ${count}`);
    },

    // Defined by: https://console.spec.whatwg.org/#countreset
    countReset(this: ConsoleInstance, label = "default") {
      const counts = this[kCounts];
      if (!counts.has(label)) {
        process.emitWarning(`Count for '${label}' does not exist`);
        return;
      }
      // trace(kTraceCount, kTraceConsoleCategory, `count::${label}`, 0, 0);
      counts.delete(`${label}`);
    },

    group(this: ConsoleInstance, ...data: unknown[]) {
      if (data.length > 0) {
        this.log.$apply(this, data);
      }
      this[kGroupIndent] += StringPrototypeRepeat.$call(" ", this[kGroupIndentationWidth]);
    },

    groupEnd(this: ConsoleInstance) {
      this[kGroupIndent] = StringPrototypeSlice.$call(
        this[kGroupIndent],
        0,
        this[kGroupIndent].length - this[kGroupIndentationWidth],
      );
    },

    // https://console.spec.whatwg.org/#table
    table(this: ConsoleInstance, tabularData, properties?: string[]) {
      if (properties !== undefined) {
        validateArray(properties, "properties");
      }

      if (tabularData === null || typeof tabularData !== "object") return this.log(tabularData);
      const final = (k: string[], v: string[][]) => this.log(table(k, v));

      const _inspect = (v: unknown): string => {
        const depth = v !== null && typeof v === "object" && !isArray(v) && Object.keys(v).length > 2 ? -1 : 0;
        const opt = {
          depth,
          maxArrayLength: 3,
          breakLength: Infinity,
          ...this[kGetInspectOptions](this._stdout),
        };
        return inspect(v, opt);
      };
      const getIndexArray = (length: number) => Array.from({ length }, (_, i) => _inspect(i));

      const mapIter = isMapIterator(tabularData);
      let isKeyValue = false;
      let i = 0;

      if (isKeyValue || $isMap(tabularData)) {
        const keys: string[] = [];
        const values: string[] = [];
        let length = 0;
        if (mapIter) {
          for (; i < tabularData.length / 2; ++i) {
            ArrayPrototypePush.$call(keys, _inspect(tabularData[i * 2]));
            ArrayPrototypePush.$call(values, _inspect(tabularData[i * 2 + 1]));
            length++;
          }
        } else {
          for (const { 0: k, 1: v } of tabularData) {
            ArrayPrototypePush.$call(keys, _inspect(k));
            ArrayPrototypePush.$call(values, _inspect(v));
            length++;
          }
        }
        return final([iterKey, keyKey, valuesKey], [getIndexArray(length), keys, values]);
      }

      const setIter = isSetIterator(tabularData);
      // if (setIter) tabularData = previewEntries(tabularData);

      const setlike = setIter || mapIter || $isSet(tabularData);
      if (setlike) {
        const values: string[] = [];
        let length = 0;
        for (const v of tabularData as Set<any>) {
          ArrayPrototypePush.$call(values, _inspect(v));
          length++;
        }
        return final([iterKey, valuesKey], [getIndexArray(length), values]);
      }

      const map: Record<string, string[]> = Object.create(null);
      let hasPrimitives = false;
      const valuesKeyArray: string[] = [];
      const indexKeyArray = Object.keys(tabularData);

      for (; i < indexKeyArray.length; i++) {
        const item = tabularData[indexKeyArray[i]];
        const primitive = item === null || (typeof item !== "function" && typeof item !== "object");
        if (properties === undefined && primitive) {
          hasPrimitives = true;
          valuesKeyArray[i] = _inspect(item);
        } else {
          const keys = properties || Object.keys(item);
          for (const key of keys) {
            map[key] ??= [];
            if ((primitive && properties) || !ObjectPrototypeHasOwnProperty.$call(item, key)) map[key][i] = "";
            else map[key][i] = _inspect(item[key]);
          }
        }
      }

      const keys = Object.keys(map);
      const values = Object.values(map);
      if (hasPrimitives) {
        ArrayPrototypePush.$call(keys, valuesKey);
        ArrayPrototypePush.$call(values, valuesKeyArray);
      }
      ArrayPrototypeUnshift.$call(keys, indexKey);
      ArrayPrototypeUnshift.$call(values, indexKeyArray);

      return final(keys, values);
    },
  };

  // Returns true if label was found
  function timeLogImpl(self: ConsoleInstance, name: string, label: string, data?: unknown[]) {
    const time = self._times.get(label);
    if (time === undefined) {
      process.emitWarning(`No such label '${label}' for console.${name}()`);
      return false;
    }
    const duration = process.hrtime(time);
    const ms = duration[0] * 1000 + duration[1] / 1e6;

    const formatted = formatTime(ms);

    if (data === undefined) {
      self.log("%s: %s", label, formatted);
    } else {
      self.log("%s: %s", label, formatted, ...data);
    }
    return true;
  }

  const { formatTime } = require("internal/util/debuglog");

  const keyKey = "Key";
  const valuesKey = "Values";
  const indexKey = "(index)";
  const iterKey = "(iteration index)";

  const isArray = (v: unknown) => $isJSArray(v) || $isTypedArrayView(v) || isBuffer(v);

  function noop() {}

  for (const method of Reflect.ownKeys(consoleMethods)) Console.prototype[method] = consoleMethods[method];

  Console.prototype.debug = Console.prototype.log;
  Console.prototype.info = Console.prototype.log;
  Console.prototype.dirxml = Console.prototype.log;
  Console.prototype.error = Console.prototype.warn;
  Console.prototype.groupCollapsed = Console.prototype.group;

  return Console;
}
