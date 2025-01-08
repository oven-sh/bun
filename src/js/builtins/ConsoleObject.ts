$overriddenName = "[Symbol.asyncIterator]";
export function asyncIterator(this: Console) {
  var stream = Bun.stdin.stream();

  var decoder = new TextDecoder("utf-8", { fatal: false });
  var indexOf = Bun.indexOfLine;
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
    var deferredError;
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
      deferredError = e;
    } finally {
      reader.releaseLock();

      if (deferredError) {
        throw deferredError;
      }
    }
  }

  const symbol = globalThis.Symbol.asyncIterator;
  this[symbol] = ConsoleAsyncIterator;
  return ConsoleAsyncIterator();
}

export function write(this: Console, input) {
  var writer = $getByIdDirectPrivate(this, "writer");
  if (!writer) {
    var length = $toLength(input?.length ?? 0);
    writer = Bun.stdout.writer({ highWaterMark: length > 65536 ? length : 65536 });
    $putByIdDirectPrivate(this, "writer", writer);
  }

  var wrote = writer.write(input);

  const count = $argumentCount();
  for (var i = 1; i < count; i++) {
    wrote += writer.write(arguments[i]);
  }

  writer.flush(true);
  return wrote;
}

// This is the `console.Console` constructor. It is mostly copied from Node.
// https://github.com/nodejs/node/blob/d2c7c367741bdcb6f7f77f55ce95a745f0b29fef/lib/internal/console/constructor.js
// Some parts are copied from imported files and inlined here. Not too much of a performance issue
// to do extra work at startup, since most people do not need `console.Console`.
// TODO: probably could extract `getStringWidth`; probably make that a native function. note how it is copied from `readline.js`
export function createConsoleConstructor(console: typeof globalThis.console) {
  const { inspect, formatWithOptions, stripVTControlCharacters } = require("node:util");
  const { isBuffer } = require("node:buffer");

  const { validateObject, validateInteger, validateArray, validateOneOf } = require("internal/validators");
  const kMaxGroupIndentation = 1000;

  const StringPrototypeIncludes = String.prototype.includes;
  const RegExpPrototypeSymbolReplace = RegExp.prototype[Symbol.replace];
  const ArrayPrototypeUnshift = Array.prototype.unshift;
  const StringPrototypeRepeat = String.prototype.repeat;
  const StringPrototypeSlice = String.prototype.slice;
  const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
  const StringPrototypePadStart = String.prototype.padStart;
  const StringPrototypeSplit = String.prototype.split;
  const NumberPrototypeToFixed = Number.prototype.toFixed;
  const StringPrototypeNormalize = String.prototype.normalize;
  const StringPrototypeCodePointAt = String.prototype.codePointAt;
  const ArrayPrototypeMap = Array.prototype.map;
  const ArrayPrototypeJoin = Array.prototype.join;
  const ArrayPrototypePush = Array.prototype.push;

  const kCounts = Symbol("counts");

  const kSecond = 1000;
  const kMinute = 60 * kSecond;
  const kHour = 60 * kMinute;

  const internalGetStringWidth = $newZigFunction("string.zig", "String.jsGetStringWidth", 1);

  /**
   * Returns the number of columns required to display the given string.
   */
  var getStringWidth = function getStringWidth(str, removeControlChars = true) {
    if (removeControlChars) str = stripVTControlCharacters(str);
    str = StringPrototypeNormalize.$call(str, "NFC");

    return internalGetStringWidth(str);
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

  const renderRow = (row, columnWidths) => {
    let out = tableChars.left;
    for (let i = 0; i < row.length; i++) {
      const cell = row[i];
      const len = getStringWidth(cell);
      const needed = (columnWidths[i] - len) / 2;
      // round(needed) + ceil(needed) will always add up to the amount
      // of spaces we need while also left justifying the output.
      out +=
        (StringPrototypeRepeat as any).$call(" ", needed) + cell + StringPrototypeRepeat.$call(" ", Math.ceil(needed));
      if (i !== row.length - 1) out += tableChars.middle;
    }
    out += tableChars.right;
    return out;
  };

  const table = (head, columns) => {
    const columnWidths = ArrayPrototypeMap.$call(head, h => getStringWidth(h)) as number[];
    const longestColumn = Math.max(...(ArrayPrototypeMap as any).$call(columns, a => a.length));
    const rows: any = $newArrayWithSize(longestColumn);

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

  const optionsMap = new WeakMap<any, any>();
  function Console(this: any, options /* or: stdout, stderr, ignoreErrors = true */) {
    // We have to test new.target here to see if this function is called
    // with new, because we need to define a custom instanceof to accommodate
    // the global console.
    if (new.target === undefined) {
      return Reflect.construct(Console, arguments);
    }

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

      if (inspectOptions.colors !== undefined && options.colorMode !== undefined) {
        throw $ERR_INCOMPATIBLE_OPTION_PAIR(
          'Option "options.inspectOptions.color" cannot be used in combination with option "colorMode"',
        );
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
    value(instance) {
      return instance[kIsConsole] || instance === console;
    },
  });

  const kColorInspectOptions = { colors: true };
  const kNoColorInspectOptions = {};

  Object.defineProperties((Console.prototype = {}), {
    [kBindStreamsEager]: {
      ...consolePropAttributes,
      // Eager version for the Console constructor
      value: function (stdout, stderr) {
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
      value: function (object) {
        let stdout;
        let stderr;
        Object.defineProperties(this, {
          "_stdout": {
            enumerable: false,
            configurable: true,
            get() {
              if (!stdout) stdout = object.stdout;
              return stdout;
            },
            set(value) {
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
            set(value) {
              stderr = value;
            },
          },
        });
      },
    },
    [kBindProperties]: {
      ...consolePropAttributes,
      value: function (ignoreErrors, colorMode, groupIndentation = 2) {
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
      value: function (streamSymbol, string) {
        const ignoreErrors = this._ignoreErrors;
        const groupIndent = this[kGroupIndent];

        const useStdout = streamSymbol === kUseStdout;
        const stream = useStdout ? this._stdout : this._stderr;
        const errorHandler = useStdout ? this._stdoutErrorHandler : this._stderrErrorHandler;

        if (groupIndent.length !== 0) {
          if (StringPrototypeIncludes.$call(string, "\n")) {
            // ?!
            string = (RegExpPrototypeSymbolReplace.$call as any)(/\n/g, string, `\n${groupIndent}`);
          }
          string = groupIndent + string;
        }
        string += "\n";

        if (ignoreErrors === false) return stream.write(string);

        // There may be an error occurring synchronously (e.g. for files or TTYs
        // on POSIX systems) or asynchronously (e.g. pipes on POSIX systems), so
        // handle both situations.
        try {
          // Add and later remove a noop error handler to catch synchronous
          // errors.
          if (stream.listenerCount("error") === 0) stream.once("error", noop);
          stream.write(string, errorHandler);
        } catch (e) {
          // Console is a debugging utility, so it swallowing errors is not
          // desirable even in edge cases such as low stack space.
          if (
            e != null &&
            typeof e === "object" &&
            e.name === "RangeError" &&
            e.message === "Maximum call stack size exceeded."
          )
            throw e;
          // Sorry, there's no proper way to pass along the error here.
        } finally {
          stream.removeListener("error", noop);
        }
      },
    },
    [kGetInspectOptions]: {
      ...consolePropAttributes,
      value: function (stream) {
        let color = this[kColorMode];
        if (color === "auto") {
          if (Bun.env["FORCE_COLOR"] !== undefined) {
            color = Bun.enableANSIColors;
          } else {
            color = stream.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
          }
        }

        const options = optionsMap.get(this);
        if (options) {
          if (options.colors === undefined) {
            options.colors = color;
          }
          return options;
        }

        return color ? kColorInspectOptions : kNoColorInspectOptions;
      },
    },
    [kFormatForStdout]: {
      ...consolePropAttributes,
      value: function (args) {
        const opts = this[kGetInspectOptions](this._stdout);
        return formatWithOptions(opts, ...args);
      },
    },
    [kFormatForStderr]: {
      ...consolePropAttributes,
      value: function (args) {
        const opts = this[kGetInspectOptions](this._stderr);
        return formatWithOptions(opts, ...args);
      },
    },
  });

  // Make a function that can serve as the callback passed to `stream.write()`.
  function createWriteErrorHandler(instance, streamSymbol) {
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

  const consoleMethods: any = {
    log(...args) {
      this[kWriteToConsole](kUseStdout, this[kFormatForStdout](args));
    },

    warn(...args) {
      this[kWriteToConsole](kUseStderr, this[kFormatForStderr](args));
    },

    dir(object, options) {
      this[kWriteToConsole](
        kUseStdout,
        inspect(object, {
          customInspect: false,
          ...this[kGetInspectOptions](this._stdout),
          ...options,
        }),
      );
    },

    time(label = "default") {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      if (this._times.has(label)) {
        process.emitWarning(`Label '${label}' already exists for console.time()`);
        return;
      }
      // trace(kTraceBegin, kTraceConsoleCategory, `time::${label}`, 0);
      this._times.set(label, process.hrtime());
    },

    timeEnd(label = "default") {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      const found = timeLogImpl(this, "timeEnd", label);
      // trace(kTraceEnd, kTraceConsoleCategory, `time::${label}`, 0);
      if (found) {
        this._times.delete(label);
      }
    },

    timeLog(label = "default", ...data) {
      // Coerces everything other than Symbol to a string
      label = `${label}`;
      timeLogImpl(this, "timeLog", label, data);
      // trace(kTraceInstant, kTraceConsoleCategory, `time::${label}`, 0);
    },

    trace: function trace(...args) {
      const err: Error = {
        name: "Trace",
        message: this[kFormatForStderr](args),
      };
      Error.captureStackTrace(err, trace);
      this.error(err.stack);
    },

    assert(expression, ...args) {
      if (!expression) {
        args[0] = `Assertion failed${args.length === 0 ? "" : `: ${args[0]}`}`;
        // The arguments will be formatted in warn() again
        this.warn.$apply(this, args);
      }
    },

    // Defined by: https://console.spec.whatwg.org/#clear
    clear() {
      // It only makes sense to clear if _stdout is a TTY.
      // Otherwise, do nothing.
      if (this._stdout.isTTY && Bun.env["TERM"] !== "dumb") {
        this._stdout.write("\x1B[2J\x1B[3J\x1B[H");
      }
    },

    // Defined by: https://console.spec.whatwg.org/#count
    count(label = "default") {
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
    countReset(label = "default") {
      const counts = this[kCounts];
      if (!counts.has(label)) {
        process.emitWarning(`Count for '${label}' does not exist`);
        return;
      }
      // trace(kTraceCount, kTraceConsoleCategory, `count::${label}`, 0, 0);
      counts.delete(`${label}`);
    },

    group(...data) {
      if (data.length > 0) {
        this.log.$apply(this, data);
      }
      this[kGroupIndent] += StringPrototypeRepeat.$call(" ", this[kGroupIndentationWidth]);
    },

    groupEnd() {
      this[kGroupIndent] = StringPrototypeSlice.$call(
        this[kGroupIndent],
        0,
        this[kGroupIndent].length - this[kGroupIndentationWidth],
      );
    },

    // https://console.spec.whatwg.org/#table
    table(tabularData, properties) {
      if (properties !== undefined) {
        validateArray(properties, "properties");
      }

      if (tabularData === null || typeof tabularData !== "object") return this.log(tabularData);
      const final = (k, v) => this.log(table(k, v));

      const _inspect = v => {
        const depth = v !== null && typeof v === "object" && !isArray(v) && Object.keys(v).length > 2 ? -1 : 0;
        const opt = {
          depth,
          maxArrayLength: 3,
          breakLength: Infinity,
          ...this[kGetInspectOptions](this._stdout),
        };
        return inspect(v, opt);
      };
      const getIndexArray = length => Array.from({ length }, (_, i) => _inspect(i));

      const mapIter = $isMapIterator(tabularData);
      let isKeyValue = false;
      let i = 0;
      // if (mapIter) {
      //   const res = previewEntries(tabularData, true);
      //   tabularData = res[0];
      //   isKeyValue = res[1];
      // }

      if (isKeyValue || $isMap(tabularData)) {
        const keys = [];
        const values = [];
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

      const setIter = $isSetIterator(tabularData);
      // if (setIter) tabularData = previewEntries(tabularData);

      const setlike = setIter || mapIter || $isSet(tabularData);
      if (setlike) {
        const values = [];
        let length = 0;
        for (const v of tabularData as Set<any>) {
          ArrayPrototypePush.$call(values, _inspect(v));
          length++;
        }
        return final([iterKey, valuesKey], [getIndexArray(length), values]);
      }

      const map = { __proto__: null };
      let hasPrimitives = false;
      const valuesKeyArray: any = [];
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
  function timeLogImpl(self, name, label, data?) {
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

  function pad(value) {
    return StringPrototypePadStart.$call(`${value}`, 2, "0");
  }

  function formatTime(ms) {
    let hours = 0;
    let minutes = 0;
    let seconds: string | number = 0;

    if (ms >= kSecond) {
      if (ms >= kMinute) {
        if (ms >= kHour) {
          hours = Math.floor(ms / kHour);
          ms = ms % kHour;
        }
        minutes = Math.floor(ms / kMinute);
        ms = ms % kMinute;
      }
      seconds = ms / kSecond;
    }

    if (hours !== 0 || minutes !== 0) {
      ({ 0: seconds, 1: ms } = (StringPrototypeSplit.$call as any)(NumberPrototypeToFixed.$call(seconds, 3), "."));
      const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
      return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
    }

    if (seconds !== 0) {
      return `${NumberPrototypeToFixed.$call(seconds, 3)}s`;
    }

    return `${Number(NumberPrototypeToFixed.$call(ms, 3))}ms`;
  }

  const keyKey = "Key";
  const valuesKey = "Values";
  const indexKey = "(index)";
  const iterKey = "(iteration index)";

  const isArray = v => $isJSArray(v) || $isTypedArrayView(v) || isBuffer(v);

  function noop() {}

  for (const method of Reflect.ownKeys(consoleMethods)) Console.prototype[method] = consoleMethods[method];

  Console.prototype.debug = Console.prototype.log;
  Console.prototype.info = Console.prototype.log;
  Console.prototype.dirxml = Console.prototype.log;
  Console.prototype.error = Console.prototype.warn;
  Console.prototype.groupCollapsed = Console.prototype.group;

  return Console;
}
