// @ts-nocheck
import { ServeOptions } from "bun";
import { afterAll,  expect, } from "bun:test";

var existingServer;
async function runInServer(opts: ServeOptions, cb: (url: string) => void | Promise<void>) {
  var server;
  const handler = {
    ...opts,
    port: 49774,
    fetch(req) {
      try {
        return opts.fetch(req);
      } catch (e) {
        console.error(e.message);
        console.log(e.stack);
        throw e;
      }
    },
    error(err) {
      console.log(err.message);
      console.log(err.stack);
      throw err;
    },
  };

  if (!existingServer) {
    existingServer = server = Bun.serve(handler);
  } else {
    server = existingServer;
    server.reload(handler);
  }

  try {
    console.log(`http://${server.hostname}:${server.port}`);
  } catch (e) {
    throw e;
  } finally {
  }
}

var bytes = new Uint8Array(1024 * 1024 * 2);
bytes.fill(0x41);

await runInServer(
  {
    async fetch(req) {
      try {
        var reader = req.body.getReader();

        const direct = {
          type: "direct",
          async pull(controller) {
            try {
              while (true) {
                const { done, value } = await reader.read();
                console.log("read", { done, value });
                if (done) {
                  console.log('done')
                  controller.end();
                  return;
                }
                controller.write(value);
              }

            } catch (e) {
              console.log(e);

            }
          },
        };

        return new Response(new ReadableStream(direct), {
          headers: req.headers,
        });
      } catch (e) {
        console.error(e);
        throw e;
      }
    },
  },
);
