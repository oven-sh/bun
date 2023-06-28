// https://html.spec.whatwg.org/multipage/server-sent-events.html
import type { EventStreamOptions, EventStream as IEventStream } from "bun";

export function getEventStream() {
  class EventStream extends ReadableStream implements IEventStream {
    // internal reference to the direct controller.
    // we initialize it to a stub that writes to an internal queue.
    // this makes it so you can call send() before the stream is started.
    #ctrl: ReadableStreamDirectController | null;
    // This field is read by `new Response`
    $contentType = "text/event-stream";

    constructor(opts: EventStreamOptions) {
      if (!opts || !$isCallable(opts.start)) throw new TypeError("EventStream requires an object with `start`");
      var queue: any[] = [];
      super({
        type: "direct",
        pull: controller => {
          this.#ctrl = controller;
          if (queue.length) {
            for (const item of queue) {
              controller.write(item);
              if (item === null) {
                controller.close();
                this.#ctrl = null;
                return;
              }
            }
            controller.flush();
          }
          opts.start?.(this);
        },
        cancel: () => {
          opts.cancel?.(this);
          this.#ctrl = null;
        },
      });
      this.#ctrl = {
        write: buf => queue.push(buf),
        flush: () => {},
        close: () => {
          queue.push(null);
        },
      } as any;
    }

    setReconnectionTime(time: number): void {
      var ctrl = this.#ctrl!;
      if (!ctrl) {
        throw new Error("EventStream is closed");
      }
      ctrl.write("retry:" + time + "\n\n");
    }

    send(event?: unknown, data?: unknown, id?: number | null | undefined): void {
      var ctrl = this.#ctrl;
      if (!ctrl) {
        throw new Error("EventStream is closed");
      }
      if (!data) {
        data = event;
        event = undefined;
      } else if (event === "message") {
        // According to spec, 'The default event type is "message"'
        // This means we can omit this event type.
        event = undefined;
      }
      if (data === undefined) {
        throw new TypeError("EventStream.send() requires a data argument");
      }
      if (id !== undefined) {
        this.#writeEventWithId(ctrl, event, data, id);
      } else {
        this.#writeEvent(ctrl, event, data);
      }
      ctrl.flush();
    }

    #writeEvent(ctrl: ReadableStreamDirectController, event: unknown, data: unknown) {
      if (event) ctrl.write("event:" + event + "\n");
      if (typeof data === "string") {
        ctrl.write("data:" + data.replace(/\n/g, "\ndata:") + "\n\n");
      } else if ($isTypedArrayView(data) || data instanceof ArrayBuffer) {
        // TODO: handle newlines in this buffer
        ctrl.write("data:");
        ctrl.write(data as BufferSource);
        ctrl.write("\n\n");
      } else {
        ctrl.write("data:" + JSON.stringify(data) + "\n\n");
      }
    }

    #writeEventWithId(ctrl: ReadableStreamDirectController, event: unknown, data: unknown, id: number | null) {
      if (event) ctrl.write("event:" + event + "\n");
      if (typeof data === "string") {
        ctrl.write("data:" + data.replace(/\n/g, "\ndata:") + "\n");
      } else if (data instanceof Uint8Array) {
        // TODO: handle newlines in this buffer
        ctrl.write("data:");
        ctrl.write(data);
        ctrl.write("\n");
      } else {
        ctrl.write("data:" + JSON.stringify(data) + "\n");
      }
      if (id === null) {
        ctrl.write("id\n");
      } else {
        ctrl.write("id:" + id + "\n");
      }
    }

    close() {
      this.#ctrl?.close();
    }
  }
  Object.defineProperty(EventStream, "name", { value: "EventStream" });
  return EventStream;
}
