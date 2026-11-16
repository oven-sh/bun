const idl = require("internal/desktop/web/idl");

type Followed = {
  priority: number;
  tasks: Set<Task>;
  dependents: Set<WeakRef<object>>;
  isFixed: boolean;
  isChanging: boolean;
};
type Task = { priority: number; isContinuation: boolean; order: number; run: () => void };

const priorities = ["user-blocking", "user-visible", "background"];
/** A continuation goes before the tasks of the same priority. */
const queues: Task[][] = [[], [], [], [], [], []];
const signals = new WeakMap<object, Followed>();
let nextOrder = 0;
let currentPriority = 1;
let currentSource: Followed | undefined;
let currentSignal: AbortSignal | undefined;

const queueOf = (task: Task) => queues[task.priority * 2 + (task.isContinuation ? 0 : 1)];
const rankOf = (priority: unknown) => priorities.indexOf(idl.oneOf(priority, priorities));

function enqueue(task: Task) {
  const { tasks } = idl.scope.env;
  const queue = queueOf(task);
  let at = queue.length;
  while (at > 0 && queue[at - 1].order > task.order) at--;
  queue.splice(at, 0, task);
  const { priority } = task;
  tasks.post(
    priority === 0 ? tasks.BLOCKING : priority === 1 ? tasks.VISIBLE : tasks.BACKGROUND,
    idl.runTask,
    runNext,
    priority,
  );
}

function runNext(priority: number) {
  (queues[priority * 2].shift() ?? queues[priority * 2 + 1].shift())?.run();
}

function forget() {
  currentPriority = 1;
  currentSource = currentSignal = undefined;
}

function schedule(
  priority: number,
  source: Followed | undefined,
  signal: AbortSignal | undefined,
  isContinuation: boolean,
  delay: number,
  callback?: Function,
) {
  signal?.throwIfAborted();
  const { promise, resolve, reject } = Promise.withResolvers();
  const aborted = () => reject(signal!.reason);
  signal?.addEventListener("abort", aborted);
  const task: Task = {
    priority,
    isContinuation,
    order: 0,
    run() {
      source?.tasks.$delete(task);
      if (signal?.aborted) return;
      if (signal !== undefined || priority !== 1) {
        [currentPriority, currentSource, currentSignal] = [priority, source, signal];
        idl.scope.env.tasks.afterMicrotasks(forget);
      }
      try {
        resolve(callback?.());
      } catch (thrown) {
        reject(thrown);
      }
      signal?.removeEventListener("abort", aborted);
    },
  };
  const start = () => {
    task.order = nextOrder++;
    if (source !== undefined) {
      task.priority = source.priority;
      source.tasks.$add(task);
    }
    enqueue(task);
  };
  if (delay > 0) {
    const { cleanups, env } = idl.scope;
    const cancel = () => env.tasks.cancel(timer);
    const timer = env.tasks.postDelayed(Math.min(delay, 2 ** 31 - 1), false, () => {
      cleanups.delete(cancel);
      start();
    });
    cleanups.add(cancel);
  } else start();
  return promise;
}

class Scheduler {
  constructor(key: unknown = undefined) {
    idl.illegal(key);
  }

  async postTask(callback: Function, options: any = undefined) {
    idl.callable(callback);
    const { delay = 0, priority, signal } = idl.dictionary(options);
    const rank = priority === undefined ? 1 : rankOf(priority);
    if (signal !== undefined) idl.signalOf(signal);
    const source = priority === undefined && signal !== undefined ? signals.get(signal) : undefined;
    return schedule(rank, source, signal, false, idl.inRange(delay), callback);
  }

  async yield() {
    return schedule(currentPriority, currentSource, currentSignal, true, 0);
  }
}
idl.expose(Scheduler);

class TaskPriorityChangeEvent extends idl.Event {
  #previousPriority: string;

  constructor(type: string, init: any) {
    idl.need(arguments.length, 2);
    super(type, init);
    this.#previousPriority = idl.oneOf(idl.dictionary(init).previousPriority, priorities);
  }

  get previousPriority() {
    return this.#previousPriority;
  }
}
idl.expose(TaskPriorityChangeEvent);

function followed(signal: object) {
  const found = signals.get(signal);
  if (found === undefined) throw new TypeError("Illegal invocation");
  return found;
}

function withPriority(signal: AbortSignal, priority: number, isFixed: boolean) {
  signals.set(signal, { priority, tasks: new Set(), dependents: new Set(), isFixed, isChanging: false });
  return Object.setPrototypeOf(signal, TaskSignal.prototype);
}

function changePriority(signal: any, priority: number) {
  const state = followed(signal);
  if (state.isChanging) throw idl.error("NotAllowedError", "The priority is already changing.");
  if (state.priority === priority) return;
  const previousPriority = priorities[state.priority];
  state.isChanging = true;
  state.priority = priority;
  for (const task of state.tasks) {
    const queue = queueOf(task);
    queue.splice(queue.indexOf(task), 1);
    task.priority = priority;
    enqueue(task);
  }
  signal.dispatchEvent(new TaskPriorityChangeEvent("prioritychange", { previousPriority }));
  for (const dependent of Array.from(state.dependents)) {
    const it = dependent.deref();
    if (it) changePriority(it, priority);
    else state.dependents.$delete(dependent);
  }
  state.isChanging = false;
}

const sources = new WeakMap<object, Followed>();

class TaskSignal extends AbortSignal {
  static any(given: unknown, init: any = undefined) {
    const signal = AbortSignal.any(idl.sequence(given).map(idl.signalOf));
    const { priority = "user-visible" } = idl.dictionary(init);
    const other = $isObject(priority) ? signals.get(priority) : undefined;
    if (other === undefined || other.isFixed) return withPriority(signal, other?.priority ?? rankOf(priority), true);
    const source = sources.get(priority) ?? other;
    sources.set(signal, source);
    source.dependents.$add(new WeakRef(signal));
    return withPriority(signal, other.priority, false);
  }

  get priority() {
    return priorities[followed(this).priority];
  }
}
require("internal/desktop/electron/bridge").defineHandlers(TaskSignal.prototype, ["prioritychange"]);
idl.expose(TaskSignal);

class TaskController extends AbortController {
  constructor(init: any = undefined) {
    const { priority = "user-visible" } = idl.dictionary(init);
    const rank = rankOf(priority);
    super();
    withPriority(this.signal, rank, false);
  }

  setPriority(priority: unknown) {
    idl.need(arguments.length, 1);
    changePriority(this.signal, rankOf(priority));
  }
}
idl.expose(TaskController);

export default { Scheduler, TaskController, TaskPriorityChangeEvent, TaskSignal };
