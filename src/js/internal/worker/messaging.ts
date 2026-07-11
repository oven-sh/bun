// worker_threads.postMessageToThread (Node 22+), ported from node's
// lib/internal/worker/messaging.js. The main thread is the hub: every thread keeps a
// control MessagePort to it, and it routes each message to the destination's port.
// Delivery results are reported back through a SharedArrayBuffer + Atomics.
//
// Differences from node: thread info comes from initThreadInfo (Bun assigns threadId
// differently); createMainThreadPort is split into createMessagingChannel (before
// `new Worker`) + registerMainThreadPort (after the threadId exists); and the
// `workerMessage` listeners are invoked directly because Bun's process.emit cannot
// report no-listeners or a throwing listener (see receiveMessageFromWorker).

const { validateNumber } = require("internal/validators");
const { SafeMap } = require("internal/primordials");

const messageTypes = {
  REGISTER_MAIN_THREAD_PORT: "registerMainThreadPort",
  UNREGISTER_MAIN_THREAD_PORT: "unregisterMainThreadPort",
  SEND_MESSAGE_TO_WORKER: "sendMessageToWorker",
  RECEIVE_MESSAGE_FROM_WORKER: "receiveMessageFromWorker",
};

// Set once via initThreadInfo() when worker_threads.ts loads.
let currentThreadId = 0;
let isMainThread = true;

// Only populated on the main thread (the hub); always empty elsewhere.
// SafeMap: its prototype is a frozen null-proto snapshot taken at bootstrap, so the
// cross-thread routing table can't be broken by user code replacing Map.prototype.
const threadsPorts = new SafeMap<number, any>();

// Only populated on child threads; always undefined on the main thread.
let mainThreadPort: any;

// SharedArrayBuffer must always be Int32, so it's * 4.
// One slot for the operation status (performing / performed) and one for the result.
const WORKER_MESSAGING_SHARED_DATA = 2 * 4;
const WORKER_MESSAGING_STATUS_INDEX = 0;
const WORKER_MESSAGING_RESULT_INDEX = 1;

// Response codes
const WORKER_MESSAGING_RESULT_DELIVERED = 0;
const WORKER_MESSAGING_RESULT_NO_LISTENERS = 1;
const WORKER_MESSAGING_RESULT_LISTENER_ERROR = 2;

function initThreadInfo(threadId: number, mainThread: boolean) {
  currentThreadId = threadId;
  isMainThread = mainThread;
}

// This event handler is always executed on the main thread only.
function handleMessageFromThread(message) {
  switch (message.type) {
    case messageTypes.REGISTER_MAIN_THREAD_PORT: {
      const { threadId, port } = message;

      // Register the port.
      threadsPorts.set(threadId, port);

      // Handle messages on this port. When another thread wants to register a
      // child, this takes care of relaying it, so any thread links to the main one.
      port.on("message", handleMessageFromThread);

      // Self-clean when the peer dies without an UNREGISTER (e.g. a grandchild
      // whose intermediate parent was terminated, so that parent's Worker#onClose
      // never ran); otherwise the stale entry lingers in the hub forever.
      port.on("close", () => {
        if (threadsPorts.get(threadId) === port) threadsPorts.delete(threadId);
      });

      // Never block the thread on this port.
      port.unref();
      break;
    }
    case messageTypes.UNREGISTER_MAIN_THREAD_PORT: {
      const port = threadsPorts.get(message.threadId);
      if (port) {
        port.close();
        threadsPorts.delete(message.threadId);
      }
      break;
    }
    case messageTypes.SEND_MESSAGE_TO_WORKER: {
      const { source, destination, value, transferList, memory } = message;
      sendMessageToWorker(source, destination, value, transferList, memory);
      break;
    }
  }
}

function handleMessageFromMainThread(message) {
  switch (message.type) {
    case messageTypes.RECEIVE_MESSAGE_FROM_WORKER:
      receiveMessageFromWorker(message.source, message.value, message.memory);
      break;
  }
}

function sendMessageToWorker(source, destination, value, transferList, memory) {
  // We are on the main thread, we can directly process the message.
  if (destination === 0) {
    receiveMessageFromWorker(source, value, memory);
    return;
  }

  // Find the port to the target thread.
  const port = threadsPorts.get(destination);

  if (!port) {
    const status = new Int32Array(memory);
    Atomics.store(status, WORKER_MESSAGING_RESULT_INDEX, WORKER_MESSAGING_RESULT_NO_LISTENERS);
    Atomics.store(status, WORKER_MESSAGING_STATUS_INDEX, 1);
    Atomics.notify(status, WORKER_MESSAGING_STATUS_INDEX, 1);
    return;
  }

  port.postMessage(
    {
      type: messageTypes.RECEIVE_MESSAGE_FROM_WORKER,
      source,
      // destination omitted: the receiver routes by port and never reads it.
      value,
      memory,
    },
    transferList,
  );
}

function receiveMessageFromWorker(source, value, memory) {
  let response = WORKER_MESSAGING_RESULT_NO_LISTENERS;

  // Don't use process.emit("workerMessage", ...): Bun's native emit routes a
  // throwing listener to reportUnhandledError instead of rethrowing, so
  // LISTENER_ERROR can't be detected. Invoke listeners directly.
  //
  // Known limitation: process.once('workerMessage', fn) listeners are not
  // removed here — the native process EventEmitter tracks isOnce internally
  // (fireEventListeners handles removal) with no JS-side onceWrapper to detect.
  // Fixing this needs the native emit to rethrow (a broader change).
  const listeners = process.listeners("workerMessage");
  const listenerCount = listeners.length;
  if (listenerCount > 0) {
    try {
      for (let i = 0; i < listenerCount; i++) {
        listeners[i].$call(process, value, source);
      }
      response = WORKER_MESSAGING_RESULT_DELIVERED;
    } catch {
      response = WORKER_MESSAGING_RESULT_LISTENER_ERROR;
    }
  }

  // Populate the result.
  const status = new Int32Array(memory);
  Atomics.store(status, WORKER_MESSAGING_RESULT_INDEX, response);
  Atomics.store(status, WORKER_MESSAGING_STATUS_INDEX, 1);
  Atomics.notify(status, WORKER_MESSAGING_STATUS_INDEX, 1);
}

// Bun half of Node's createMainThreadPort: create the channel linking a (future)
// thread to the main thread. Called before `new Worker`.
function createMessagingChannel() {
  const { port1, port2 } = new globalThis.MessageChannel();
  // port1 (portToMain) stays with the hub; port2 (portToWorker) is transferred to
  // the new thread where it becomes that thread's mainThreadPort.
  return { portToMain: port1, portToWorker: port2 };
}

// Bun half of Node's createMainThreadPort: register the hub-side port now that the
// child's threadId is known. Called after `new Worker`.
function registerMainThreadPort(threadId: number, portToMain: any) {
  const registrationMessage = {
    type: messageTypes.REGISTER_MAIN_THREAD_PORT,
    threadId,
    port: portToMain,
  };

  if (isMainThread) {
    handleMessageFromThread(registrationMessage);
  } else if (mainThreadPort) {
    mainThreadPort.postMessage(registrationMessage, [portToMain]);
  }
  // Not connected to the main-thread hub (e.g. a raw Web Worker): the child still works,
  // it's just unreachable via postMessageToThread.
}

function destroyMainThreadPort(threadId: number) {
  const unregistrationMessage = {
    type: messageTypes.UNREGISTER_MAIN_THREAD_PORT,
    threadId,
  };

  if (isMainThread) {
    handleMessageFromThread(unregistrationMessage);
  } else if (mainThreadPort) {
    mainThreadPort.postMessage(unregistrationMessage);
  }
}

// Deliveries from the main-thread hub are deferred until the entry module has
// finished evaluating (the native side invokes the entryEvaluated hook right
// before dispatching 'online'), matching node's bootstrap -> synchronous CJS
// main ordering: a routed message must not observe "no listeners" while the
// entry that registers them is still loading.
let entryEvaluated = false;
let pendingMainPortMessages: any[] | null = null;

function handleMessageFromMainThreadGated(message) {
  if (!entryEvaluated) {
    (pendingMainPortMessages ??= []).push(message);
    return;
  }
  handleMessageFromMainThread(message);
}

function setupMainThreadPort(port: any, setEntryEvaluatedHook: (hook: () => void) => void) {
  mainThreadPort = port;
  mainThreadPort.on("message", handleMessageFromMainThreadGated);

  // Stored on ZigGlobalObject (WriteBarrier), not on globalThis, so user code
  // can't observe or clobber it. WebWorker__dispatchOnline calls it once.
  setEntryEvaluatedHook(() => {
    entryEvaluated = true;
    const pending = pendingMainPortMessages;
    pendingMainPortMessages = null;
    // Indexed, not for-of: Array.prototype[Symbol.iterator] is user-overridable.
    if (pending) for (let i = 0; i < pending.length; i++) handleMessageFromMainThread(pending[i]);
  });

  // Never block the process on this port.
  mainThreadPort.unref();
}

async function postMessageToThread(threadId, value, transferList, timeout) {
  if (typeof transferList === "number" && typeof timeout === "undefined") {
    timeout = transferList;
    transferList = [];
  }

  if (typeof transferList === "undefined") {
    transferList = [];
  }

  if (typeof timeout !== "undefined") {
    validateNumber(timeout, "timeout", 0);
  }

  if (threadId === currentThreadId) {
    throw $ERR_WORKER_MESSAGING_SAME_THREAD("Cannot send a message to the same thread.");
  }

  const memory = new SharedArrayBuffer(WORKER_MESSAGING_SHARED_DATA);
  const status = new Int32Array(memory);
  const promise = Atomics.waitAsync(status, WORKER_MESSAGING_STATUS_INDEX, 0, timeout).value;

  const message = {
    type: messageTypes.SEND_MESSAGE_TO_WORKER,
    source: currentThreadId,
    destination: threadId,
    value,
    memory,
    transferList,
  };

  if (isMainThread) {
    handleMessageFromThread(message);
  } else if (mainThreadPort) {
    mainThreadPort.postMessage(message, transferList);
  } else {
    // This thread is not connected to the main-thread hub (e.g. created via the raw Web
    // Worker API), so there is no route to the destination.
    Atomics.store(status, WORKER_MESSAGING_RESULT_INDEX, WORKER_MESSAGING_RESULT_NO_LISTENERS);
    Atomics.store(status, WORKER_MESSAGING_STATUS_INDEX, 1);
    Atomics.notify(status, WORKER_MESSAGING_STATUS_INDEX, 1);
  }

  // Wait for the response.
  const response = await promise;

  if (response === "timed-out") {
    throw $ERR_WORKER_MESSAGING_TIMEOUT("The operation timed out.");
  } else if (status[WORKER_MESSAGING_RESULT_INDEX] === WORKER_MESSAGING_RESULT_NO_LISTENERS) {
    throw $ERR_WORKER_MESSAGING_FAILED(
      "The destination thread no longer exists or is not listening for `workerMessage` events.",
    );
  } else if (status[WORKER_MESSAGING_RESULT_INDEX] === WORKER_MESSAGING_RESULT_LISTENER_ERROR) {
    throw $ERR_WORKER_MESSAGING_ERRORED("The destination thread threw an error while processing the message.");
  }
}

export default {
  initThreadInfo,
  createMessagingChannel,
  registerMainThreadPort,
  destroyMainThreadPort,
  setupMainThreadPort,
  postMessageToThread,
};
