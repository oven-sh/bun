import type { EventStreamOptions, EventStream as IEventStream } from "bun";

export function getEventStream() {
  return class EventStream extends ReadableStream implements IEventStream {
    #ctrl: ReadableStreamDirectController | undefined;

    constructor(opts?: EventStreamOptions) {
      super({
        type: "direct",
        pull: controller => {
          this.#ctrl = controller;
          opts?.start?.(this);
        },
        cancel: () => {
          opts?.cancel?.(this);
          this.#ctrl = undefined;
        },
      });
      $putByIdDirectPrivate(this, "contentType", "text/event-stream");
    }

    send(event?: unknown, data?: unknown): void {
      var ctrl = this.#ctrl!;
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
      if (typeof data === "string") {
        ctrl.write("data: " + data.replace(/\n/g, "\ndata: ") + "\n\n");
      } else {
        if (event) ctrl.write("event: " + event + "\n");
        ctrl.write("data: " + JSON.stringify(data) + "\n\n");
      }
      ctrl.flush();
    }

    close() {
      this.#ctrl?.close();
    }
  };
}
