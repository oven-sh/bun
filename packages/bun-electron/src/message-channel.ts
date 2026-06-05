// MessageChannelMain / MessagePortMain — Electron-compatible main-process
// message channels. This is a faithful in-process implementation: a channel
// holds two entangled ports; postMessage on one delivers a "message" event on
// the other. Delivery is buffered until start() is called (matching the
// underlying MessagePort semantics).

import { EventEmitter } from "node:events";

export interface MessageEvent {
  data: unknown;
  ports: MessagePortMain[];
}

export class MessagePortMain extends EventEmitter {
  /** @internal */ _peer: MessagePortMain | null = null;
  private _started = false;
  private _closed = false;
  private _queue: MessageEvent[] = [];

  postMessage(message: unknown, transfer: MessagePortMain[] = []): void {
    if (this._closed || !this._peer) return;
    this._peer._receive({ data: message, ports: transfer });
  }

  start(): void {
    if (this._started) return;
    this._started = true;
    const queued = this._queue;
    this._queue = [];
    for (const event of queued) this.emit("message", event);
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.emit("close");
  }

  /** @internal */
  _receive(event: MessageEvent): void {
    if (this._closed) return;
    if (this._started) this.emit("message", event);
    else this._queue.push(event);
  }
}

export class MessageChannelMain {
  readonly port1: MessagePortMain;
  readonly port2: MessagePortMain;

  constructor() {
    this.port1 = new MessagePortMain();
    this.port2 = new MessagePortMain();
    this.port1._peer = this.port2;
    this.port2._peer = this.port1;
  }
}
