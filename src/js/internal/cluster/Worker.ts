const EventEmitter = require("node:events");

/** The members of a `ChildProcess` (in the primary) or of `process` (in a worker) that `node:cluster` uses. */
export interface WorkerProcess {
  connected: boolean;
  exitCode?: number | string | null;
  signalCode?: string | null;
  channel?: unknown;
  on(type: string, listener: $Node.Listener): unknown;
  once(type: string, listener: $Node.Listener): unknown;
  /** With `disconnect`: there while the process has a channel. */
  send?(message: unknown, ...args: unknown[]): boolean;
  disconnect?(): void;
  kill(signal?: string | number): boolean;
}

/** What a handle tells the worker that asked for it. */
export type SendReply = (errno: number | null, reply: object | null, handle: object | null) => void;

export interface ClusterWorker extends InstanceType<typeof EventEmitter> {
  exitedAfterDisconnect: boolean | undefined;
  state: string;
  id: number;
  process: WorkerProcess;
  kill(signo?: string): void;
  send(message: unknown, ...args: unknown[]): boolean;
  isDead(): boolean;
  isConnected(): boolean;
  disconnect(): this;
  destroy(signo?: string): void;
  _disconnect?(primaryInitiated?: boolean): void;
}

const ObjectFreeze = Object.freeze;

const kEmptyObject: {} = ObjectFreeze(Object.create(null));

function Worker(this: ClusterWorker, options?: { id?: number; state?: string; process?: WorkerProcess } | null): void {
  if (!(this instanceof Worker)) return new Worker(options) as any;

  EventEmitter.$apply(this, []);

  if (options === null || typeof options !== "object") options = kEmptyObject;

  this.exitedAfterDisconnect = undefined;

  this.state = options.state || "none";
  this.id = options.id! | 0;

  const workerProcess = options.process;
  if (workerProcess) {
    this.process = workerProcess;
    workerProcess.on("error", (code: unknown, signal: unknown) => this.emit("error", code, signal));
    workerProcess.on("message", (message: unknown, handle: unknown) => this.emit("message", message, handle));
  }
}
$toClass(Worker, "Worker", EventEmitter);

Worker.prototype.kill = function (this: ClusterWorker) {
  this.destroy.$apply(this, arguments as unknown as [signo?: string]);
};

Worker.prototype.send = function (this: ClusterWorker) {
  return this.process.send!.$apply(this.process, arguments as unknown as [message: unknown, ...rest: unknown[]]);
};

Worker.prototype.isDead = function (this: ClusterWorker) {
  return this.process.exitCode != null || this.process.signalCode != null;
};

Worker.prototype.isConnected = function (this: ClusterWorker) {
  return this.process.connected;
};

export default Worker;
