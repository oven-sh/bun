// Readable.fromWeb() and Duplex.fromWeb() read through a read request of the web stream, which two natives of the adapter module make and start. The steps of the request are functions
// of that module, and native code calls them: the close step and the error step where the stream closes or errors, the chunk step one microtask after the stream hands a chunk over.
// What a program sees of that is when its node stream has ended or is destroyed, and the order of its events.
const { Readable, Duplex, finished } = require("node:stream");

const turn = () => new Promise(resolve => setImmediate(resolve));
const adapters = {
  "Readable.fromWeb": web => Readable.fromWeb(web),
  "Duplex.fromWeb": web => Duplex.fromWeb({ readable: web, writable: new WritableStream() }),
};
const open = x => new ReadableStream({ start: controller => void (x.controller = controller) });

const cases = {
  "a closed stream, one read()": {
    web: () => new ReadableStream({ start: controller => controller.close() }),
    act: (stream, x, log) => void log.push("read: " + stream.read()),
  },
  "a read waits, close()": {
    web: open,
    act: async (stream, x, log) => {
      stream.read();
      await turn();
      x.controller.close();
      log.push("ended inside close(): " + stream._readableState.ended);
    },
  },
  "three chunks and the end": {
    web: () => {
      let byte = 0;
      return new ReadableStream({
        pull(controller) {
          if (byte++ < 3) controller.enqueue(new Uint8Array([byte]));
          else controller.close();
        },
      });
    },
    act: (stream, x, log) => void stream.on("data", data => log.push("data: " + data[0])),
  },
  "a chunk and an error in one turn": {
    web: open,
    act: async (stream, x, log) => {
      stream.on("data", data => log.push("data: " + data[0]));
      await turn();
      x.controller.enqueue(new Uint8Array([7]));
      x.controller.error(new Error("boom"));
    },
  },
  "a read waits, error()": {
    web: open,
    act: async (stream, x, log) => {
      stream.read();
      await turn();
      x.controller.error(new Error("boom"));
      log.push("destroyed inside error(): " + stream.destroyed);
    },
  },
  "a read waits, destroy()": {
    web: x => new ReadableStream({ cancel: () => void (x.cancelled = true) }),
    act: async (stream, x, log) => {
      finished(stream, error => log.push("finished: " + (error ? error.code : "ok")));
      stream.read();
      await turn();
      stream.destroy();
      log.push("ended inside destroy(): " + stream._readableState.ended);
      await turn();
      log.push("the source is cancelled: " + x.cancelled);
    },
  },
};

(async () => {
  for (const [adapter, adapt] of Object.entries(adapters)) {
    for (const [name, { web, act }] of Object.entries(cases)) {
      const x = {};
      const log = [];
      const stream = adapt(web(x));
      for (const event of ["end", "finish", "close"]) stream.on(event, () => log.push(event));
      stream.on("error", error => log.push("error: " + error.message));
      await turn();
      await turn();
      await act(stream, x, log);
      for (let i = 0; i < 4; i++) await turn();
      console.log(`${adapter}, ${name}: ${log.join(", ")}`);
    }
  }
})();
