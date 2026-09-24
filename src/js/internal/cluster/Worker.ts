import type { ChildProcess } from "node:child_process";

const EventEmitter = require("node:events");

export interface ClusterWorker extends InstanceType<typeof EventEmitter> {
  exitedAfterDisconnect: boolean | undefined;
  state: string;
  id: number;
  process?: ChildProcess | NodeJS.Process;
  kill(signo?: string): void;
  send(message: unknown, ...args: unknown[]): boolean;
  isDead(): boolean;
  isConnected(): boolean;
  disconnect(): this;
  destroy(signo?: string): void;
  _disconnect?(primaryInitiated?: boolean): void;
}

const ObjectFreeze = Object.freeze;

const kEmptyObject = ObjectFreeze(Object.create(null));

function Worker(options): void {
  if (!(this instanceof Worker)) return new Worker(options);

  EventEmitter.$apply(this, []);

  if (options === null || typeof options !== "object") options = kEmptyObject;

  this.exitedAfterDisconnect = undefined;

  this.state = options.state || "none";
  this.id = options.id | 0;

  const workerProcess = options.process;
  if (workerProcess) {
    this.process = workerProcess;
    workerProcess.on("error", (code, signal) => this.emit("error", code, signal));
    workerProcess.on("message", (message, handle) => this.emit("message", message, handle));
  }
}
$toClass(Worker, "Worker", EventEmitter);

Worker.prototype.kill = function () {
  this.destroy.$apply(this, arguments);
};

Worker.prototype.send = function () {
  return this.process.send.$apply(this.process, arguments);
};

Worker.prototype.isDead = function () {
  return this.process.exitCode != null || this.process.signalCode != null;
};

Worker.prototype.isConnected = function () {
  return this.process.connected;
};

export default Worker;
