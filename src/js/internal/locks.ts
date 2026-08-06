// Web Locks API (https://w3c.github.io/web-locks/), exposed as
// `navigator.locks` and `worker_threads.locks` like Node.js.
//
// This is a port of Node's lib/internal/locks.js, with the promise/callback
// plumbing from src/node_locks.cc done here in JS instead: the native side
// (BunWebLocksRegistry.cpp) only keeps the process-wide lock table shared
// across workers and reports grant/miss/steal decisions for this thread
// through `onNativeEvent(type, id)`.
// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/locks.js
// https://github.com/nodejs/node/blob/v26.3.0/src/node_locks.cc
//
// Known deviations from Node, both intentional:
// - A synchronously-throwing callback releases the lock (see onNativeEvent);
//   Node's ProcessQueue keeps it held forever (node_locks.cc:471-484 rejects
//   the promises without ReleaseLock), deadlocking later requests.
// - Illegal construction and bad `this` throw proper ERR_ILLEGAL_CONSTRUCTOR
//   / ERR_INVALID_THIS errors; Node currently throws `TypeError:
//   ERR_INVALID_THIS is not a constructor` because its locks.js destructures
//   the error classes from the `internal/errors` module instead of its
//   `.codes`. Both are still TypeErrors.
const { validateFunction, validateAbortSignal } = require("internal/validators");
const { kEmptyObject, hideFromStack } = require("internal/shared");
const { SafeMap } = require("internal/primordials");
const dc = require("node:diagnostics_channel");

// (name: string, exclusive: boolean, steal: boolean, ifAvailable: boolean) => id
const enqueueRequest = $newCppFunction("BunWebLocksRegistry.cpp", "jsWebLocksEnqueueRequest", 4);
// Synchronously deliver pending grant/miss/steal events for this thread.
const drainEvents = $newCppFunction("BunWebLocksRegistry.cpp", "jsWebLocksDrain", 0);
// (id: number, name: string) — release a held lock, then drain.
const releaseHeldLock = $newCppFunction("BunWebLocksRegistry.cpp", "jsWebLocksRelease", 2);

const lockRequestStartChannel = dc.channel("locks.request.start");
const lockRequestGrantChannel = dc.channel("locks.request.grant");
const lockRequestMissChannel = dc.channel("locks.request.miss");
const lockRequestEndChannel = dc.channel("locks.request.end");

const kName = Symbol("kName");
const kMode = Symbol("kMode");
const kConstructLock = Symbol("kConstructLock");
const kConstructLockManager = Symbol("kConstructLockManager");

const LOCK_MODE_EXCLUSIVE = "exclusive";
const LOCK_MODE_SHARED = "shared";

// Event types delivered by BunWebLocksRegistry.cpp.
const kEventGranted = 0;
const kEventMiss = 1;
const kEventStolen = 2;

interface LockRequestState {
  name: string;
  mode: string;
  clientId: string;
  callback: (lock: { name: string; mode: string } | null) => unknown;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  granted: boolean;
  stolen: boolean;
}

// Every outstanding request/held lock owned by this thread, keyed by the
// native request id. This doubles as this thread's query() snapshot source:
// entries with granted=false are pending, granted=true are held.
const requests = new SafeMap() as Map<number, LockRequestState>;

let cachedClientId: string | undefined;
function getClientId(): string {
  if (cachedClientId === undefined) {
    // Lazy: worker_threads requires this module at its top level.
    const { threadId } = require("node:worker_threads");
    cachedClientId = `node-${process.pid}-${threadId}`;
  }
  return cachedClientId;
}

// Web IDL conversion helpers matching Node's lib/internal/webidl.js output.
function makeWebidlError(message: string, code: string): TypeError {
  const error = new TypeError(message);
  (error as any).code = code;
  return error;
}
hideFromStack(makeWebidlError);

function toDOMString(value: unknown, context: string): string {
  if (typeof value === "symbol") {
    throw makeWebidlError(`${context} is a Symbol and cannot be converted to a string.`, "ERR_INVALID_ARG_TYPE");
  }
  return `${value}`;
}
hideFromStack(toDOMString);

// Web IDL dictionary LockOptions; members are read in sorted order like
// Node's createDictionaryConverter.
function convertLockOptions(options) {
  if (options !== null && options !== undefined && typeof options !== "object" && typeof options !== "function") {
    throw makeWebidlError("Value cannot be converted to a dictionary", "ERR_INVALID_ARG_TYPE");
  }
  const result = {
    __proto__: null,
    mode: LOCK_MODE_EXCLUSIVE,
    ifAvailable: false,
    steal: false,
    signal: undefined,
  };
  if (options === null || options === undefined) {
    return result;
  }
  const ifAvailable = options.ifAvailable;
  if (ifAvailable !== undefined) {
    result.ifAvailable = !!ifAvailable;
  }
  const mode = options.mode;
  if (mode !== undefined) {
    const converted = toDOMString(mode, "mode");
    if (converted !== LOCK_MODE_SHARED && converted !== LOCK_MODE_EXCLUSIVE) {
      throw makeWebidlError(`mode '${converted}' is not a valid enum value of type LockMode.`, "ERR_INVALID_ARG_VALUE");
    }
    result.mode = converted;
  }
  const signal = options.signal;
  if (signal !== undefined) {
    if (signal === null || (typeof signal !== "object" && typeof signal !== "function")) {
      throw makeWebidlError("signal is not an object.", "ERR_INVALID_ARG_TYPE");
    }
    result.signal = signal;
  }
  const steal = options.steal;
  if (steal !== undefined) {
    result.steal = !!steal;
  }
  return result;
}
hideFromStack(convertLockOptions);

// https://w3c.github.io/web-locks/#api-lock
class Lock {
  constructor(symbol = undefined, name?: string, mode?: string) {
    if (symbol !== kConstructLock) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
    this[kName] = name;
    this[kMode] = mode;
  }

  get name() {
    if (this instanceof Lock) {
      return this[kName];
    }
    throw $ERR_INVALID_THIS("Lock");
  }

  get mode() {
    if (this instanceof Lock) {
      return this[kMode];
    }
    throw $ERR_INVALID_THIS("Lock");
  }
}

Object.defineProperty(Lock.prototype, "name", { enumerable: true });
Object.defineProperty(Lock.prototype, "mode", { enumerable: true });
Object.defineProperty(Lock.prototype, Symbol.toStringTag, {
  value: "Lock",
  writable: false,
  enumerable: false,
  configurable: true,
});

function createLock(internalLock: { name: string; mode: string } | null) {
  return internalLock === null ? null : new Lock(kConstructLock, internalLock.name, internalLock.mode);
}

function publishLockRequestStart(name: string, mode: string) {
  if (lockRequestStartChannel.hasSubscribers) {
    lockRequestStartChannel.publish({ name, mode });
  }
}

function publishLockRequestGrant(name: string, mode: string) {
  if (lockRequestGrantChannel.hasSubscribers) {
    lockRequestGrantChannel.publish({ name, mode });
  }
}

function publishLockRequestMiss(name: string, mode: string, ifAvailable: boolean) {
  if (ifAvailable && lockRequestMissChannel.hasSubscribers) {
    lockRequestMissChannel.publish({ name, mode });
  }
}

function publishLockRequestEnd(name: string, mode: string, ifAvailable: boolean, steal: boolean, error: unknown) {
  if (lockRequestEndChannel.hasSubscribers) {
    lockRequestEndChannel.publish({ name, mode, ifAvailable, steal, error });
  }
}

// Equivalent of the native `locks.request()` binding in Node: returns the
// "released" promise, which settles with the callback's result once the lock
// (if granted) has been released again.
function requestInternal(
  name: string,
  clientId: string,
  mode: string,
  steal: boolean,
  ifAvailable: boolean,
  callback: LockRequestState["callback"],
): Promise<unknown> {
  const { promise, resolve, reject } = $newPromiseCapability(Promise);
  const id = enqueueRequest(name, mode === LOCK_MODE_EXCLUSIVE, steal, ifAvailable);
  requests.set(id, { name, mode, clientId, callback, resolve, reject, granted: false, stolen: false });
  // If the request is immediately grantable (or misses with ifAvailable),
  // this invokes the callback synchronously, matching Node.
  drainEvents();
  return promise;
}

function finishHeldLock(state: LockRequestState, id: number) {
  requests.delete(id);
  // For stolen locks the registry entry is already gone; this then just
  // re-checks the queue, matching Node's ReleaseLockAndProcessQueue.
  releaseHeldLock(id, state.name);
}

function onNativeEvent(type: number, id: number) {
  const state = requests.get(id);
  if (state === undefined) {
    return;
  }

  if (type === kEventStolen) {
    state.stolen = true;
    requests.delete(id);
    state.reject(new DOMException("The operation was aborted", "AbortError"));
    return;
  }

  if (type === kEventMiss) {
    requests.delete(id);
    let result;
    try {
      result = state.callback(null);
    } catch (error) {
      state.reject(error);
      return;
    }
    state.resolve(result);
    return;
  }

  if (type !== kEventGranted) {
    return;
  }

  state.granted = true;
  let result;
  try {
    result = state.callback({ name: state.name, mode: state.mode });
  } catch (error) {
    // Unlike Node (which leaves the lock held forever here), release the
    // lock when the callback throws synchronously, per the Web Locks spec.
    finishHeldLock(state, id);
    state.reject(error);
    return;
  }
  if ($isPromise(result)) {
    result.$then(
      value => {
        finishHeldLock(state, id);
        if (!state.stolen) state.resolve(value);
      },
      error => {
        finishHeldLock(state, id);
        if (!state.stolen) state.reject(error);
      },
    );
  } else {
    // Non-promise return values (including thenables) release the lock
    // immediately, matching Node.
    finishHeldLock(state, id);
    state.resolve(result);
  }
}

// https://w3c.github.io/web-locks/#api-lock-manager
class LockManager {
  constructor(symbol = undefined) {
    if (symbol !== kConstructLockManager) {
      throw $ERR_ILLEGAL_CONSTRUCTOR();
    }
  }

  // https://w3c.github.io/web-locks/#api-lock-manager-request
  async request(name, options, callback = undefined) {
    if (callback === undefined) {
      callback = options;
      options = undefined;
    }

    name = toDOMString(name, "Value");
    validateFunction(callback, "callback");

    if (options === undefined || typeof options === "function") {
      options = kEmptyObject;
    }

    options = convertLockOptions(options);
    const { mode, ifAvailable, steal, signal } = options;

    validateAbortSignal(signal, "options.signal");

    if (signal) {
      signal.throwIfAborted();
    }

    if (name[0] === "-") {
      throw new DOMException("Lock name may not start with hyphen", "NotSupportedError");
    }

    if (ifAvailable === true && steal === true) {
      throw new DOMException("ifAvailable and steal are mutually exclusive", "NotSupportedError");
    }

    if (mode !== LOCK_MODE_EXCLUSIVE && steal === true) {
      throw new DOMException(`mode: "${LOCK_MODE_SHARED}" and steal are mutually exclusive`, "NotSupportedError");
    }

    if (signal && (steal === true || ifAvailable === true)) {
      throw new DOMException("signal cannot be used with steal or ifAvailable", "NotSupportedError");
    }

    const clientId = getClientId();
    publishLockRequestStart(name, mode);

    if (signal) {
      return new Promise((resolve, reject) => {
        let lockGranted = false;

        const abortListener = () => {
          if (!lockGranted) {
            // `||` (not ??): Node replaces any falsy reason with an AbortError.
            reject(signal.reason || new DOMException("The operation was aborted", "AbortError"));
          }
        };

        signal.addEventListener("abort", abortListener, { once: true });

        const wrappedCallback = lock => {
          return (async () => {
            // Defer one microtask so an abort that happened after the grant
            // decision but before this runs is still honored, like Node.
            await undefined;
            if (signal.aborted) {
              return undefined;
            }
            lockGranted = true;
            publishLockRequestGrant(name, mode);
            return callback(createLock(lock));
          })();
        };

        try {
          const released = requestInternal(name, clientId, mode, steal, ifAvailable, wrappedCallback);
          released.$then(
            result => {
              signal.removeEventListener("abort", abortListener);
              publishLockRequestEnd(name, mode, ifAvailable, steal, undefined);
              resolve(result);
            },
            error => {
              signal.removeEventListener("abort", abortListener);
              publishLockRequestEnd(name, mode, ifAvailable, steal, error);
              reject(error);
            },
          );
        } catch (error) {
          signal.removeEventListener("abort", abortListener);
          publishLockRequestEnd(name, mode, ifAvailable, steal, error);
          reject(error);
        }
      });
    }

    // When ifAvailable is true and the lock is not available, the callback
    // is invoked with null.
    const wrapCallback = internalLock => {
      if (internalLock === null) {
        publishLockRequestMiss(name, mode, ifAvailable);
      } else {
        publishLockRequestGrant(name, mode);
      }
      return callback(createLock(internalLock));
    };

    try {
      const result = await requestInternal(name, clientId, mode, steal, ifAvailable, wrapCallback);
      publishLockRequestEnd(name, mode, ifAvailable, steal, undefined);
      return result;
    } catch (error) {
      publishLockRequestEnd(name, mode, ifAvailable, steal, error);
      throw error;
    }
  }

  // https://w3c.github.io/web-locks/#api-lock-manager-query
  // Like Node, the snapshot only contains this thread's held locks and
  // pending requests (node_locks.cc LockManager::Query filters on the
  // current Environment), and a request whose signal aborted stays in
  // `pending` until it is eventually granted and auto-released.
  async query() {
    if (this instanceof LockManager) {
      const held: object[] = [];
      const pending: object[] = [];
      for (const state of requests.values()) {
        const info = { name: state.name, mode: state.mode, clientId: state.clientId };
        if (state.granted) {
          held.push(info);
        } else {
          pending.push(info);
        }
      }
      return { held, pending };
    }
    throw $ERR_INVALID_THIS("LockManager");
  }
}

Object.defineProperty(LockManager.prototype, "request", { enumerable: true });
Object.defineProperty(LockManager.prototype, "query", { enumerable: true });
Object.defineProperty(LockManager.prototype, Symbol.toStringTag, {
  value: "LockManager",
  writable: false,
  enumerable: false,
  configurable: true,
});

export default {
  Lock,
  LockManager,
  locks: new LockManager(kConstructLockManager),
  onNativeEvent,
};
