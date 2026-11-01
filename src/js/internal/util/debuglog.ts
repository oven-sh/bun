// Port of node v26.3.0 lib/internal/util/debuglog.js: debuglog (used by node:util
// and internal modules) and the timing formatter shared by console.timeEnd/timeLog.
// The prototype methods are captured at module load for tamper resistance.
const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeToUpperCase = String.prototype.toUpperCase;
const StringPrototypeToLowerCase = String.prototype.toLowerCase;
const StringPrototypeReplace = String.prototype.replace;
const StringPrototypeReplaceAll = String.prototype.replaceAll;
const RegExpPrototypeExec = RegExp.prototype.exec;
const ObjectDefineProperty = Object.defineProperty;
const StringPrototypeSplit: (this: string, separator: string, limit?: number) => string[] = String.prototype.split;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const MathFloor = Math.floor;
const NumberCtor = Number;

function pad(value: string | number) {
  return StringPrototypePadStart.$call(`${value}`, 2, "0");
}

function formatTime(ms: number) {
  let hours = 0;
  let minutes = 0;
  let seconds: string | number = 0;

  if (ms >= kSecond) {
    if (ms >= kMinute) {
      if (ms >= kHour) {
        hours = MathFloor(ms / kHour);
        ms = ms % kHour;
      }
      minutes = MathFloor(ms / kMinute);
      ms = ms % kMinute;
    }
    seconds = ms / kSecond;
  }

  if (hours !== 0 || minutes !== 0) {
    ({ 0: seconds, 1: ms } = StringPrototypeSplit.$call(NumberPrototypeToFixed.$call(seconds, 3), ".") as any);
    const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
    return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
  }

  if (seconds !== 0) {
    return `${NumberPrototypeToFixed.$call(seconds, 3)}s`;
  }

  return `${NumberCtor(NumberPrototypeToFixed.$call(ms, 3))}ms`;
}

type DebugLoggerFunction = (...args: unknown[]) => void;
interface DebugLogger extends DebugLoggerFunction {
  readonly enabled: boolean;
}

const debugImpls: Record<string, DebugLoggerFunction> = { __proto__: null } as any;
let testEnabled: (set: string) => boolean;

{
  let debugEnv = Bun.env.NODE_DEBUG;
  if (debugEnv) {
    debugEnv = StringPrototypeReplace.$call(debugEnv, /[|\\{}()[\]^$+?.]/g, "\\$&");
    debugEnv = StringPrototypeReplaceAll.$call(debugEnv, "*", ".*");
    debugEnv = StringPrototypeReplaceAll.$call(debugEnv, ",", "$|^");
    const debugEnvRegex = new RegExp(`^${debugEnv}$`, "i");
    testEnabled = str => RegExpPrototypeExec.$call(debugEnvRegex, str) !== null;
  } else {
    testEnabled = () => false;
  }
}

// Emits a warning when the user enables NODE_DEBUG=http or NODE_DEBUG=http2.
function emitWarningIfNeeded(set: string) {
  if ("HTTP" === set || "HTTP2" === set) {
    process.emitWarning(
      "Setting the NODE_DEBUG environment variable " +
        "to '" +
        StringPrototypeToLowerCase.$call(set) +
        "' can expose sensitive " +
        "data (such as passwords, tokens and authentication headers) " +
        "in the resulting log.",
    );
  }
}

const noop: DebugLoggerFunction = () => {};

function debuglogImpl(enabled: boolean, set: string): DebugLoggerFunction {
  if (debugImpls[set] === undefined) {
    if (enabled) {
      const pid = process.pid;
      emitWarningIfNeeded(set);
      debugImpls[set] = function debug(...args: unknown[]) {
        const msg = require("internal/util/inspect").format(...args);
        console.error("%s %d: %s", set, pid, msg);
      };
    } else {
      debugImpls[set] = noop;
    }
  }
  return debugImpls[set];
}

// The returned logger resolves its section lazily, on the first call or the
// first read of `enabled`, and hands the resolved implementation to `cb`.
function debuglog(set: string, cb?: (fn: DebugLoggerFunction) => void): DebugLogger {
  let enabled: boolean;
  function init() {
    set = StringPrototypeToUpperCase.$call(set);
    enabled = testEnabled(set);
  }
  let debug: DebugLoggerFunction = (...args: unknown[]) => {
    init();
    // Only invokes debuglogImpl() when the debug function is called for the first time.
    debug = debuglogImpl(enabled, set);
    if (typeof cb === "function") cb(debug);
    switch (args.length) {
      case 1:
        return debug(args[0]);
      case 2:
        return debug(args[0], args[1]);
      default:
        return debug(...args);
    }
  };
  let test = () => {
    init();
    test = () => enabled;
    return enabled;
  };
  const logger = (...args: unknown[]) => {
    switch (args.length) {
      case 1:
        return debug(args[0]);
      case 2:
        return debug(args[0], args[1]);
      default:
        return debug(...args);
    }
  };
  ObjectDefineProperty(logger, "enabled", {
    __proto__: null,
    get() {
      return test();
    },
    configurable: true,
    enumerable: true,
  } as PropertyDescriptor);
  return logger as DebugLogger;
}

export default {
  debuglog,
  debuglogImpl,
  formatTime,
};
