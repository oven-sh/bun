import { Server } from 'slash-create';
import { MultipartData } from 'slash-create/lib/util/multipartData.js';

export default class BunServer extends Server {
  #server = null;
  #handler = null;
  isWebserver = true;

  constructor() {
    super({ alreadyListening: true });
  }

  createEndpoint(path, handler) {
    this.#handler = handler;
  }

  stop() {
    if (this.#server) this.#server.close();
    else throw new Error('BunServer not started');
  }

  listen(port, options = {}) {
    const getHandler = () => this.#handler;

    this.#server = Bun.serve({
      port,
      ...options,

      async fetch(req) {
        const handler = getHandler();
        if (!handler) return new Response('Server has no handler.', { status: 503 });
        if (req.method !== 'POST') return new Response('Server only supports POST requests.', { status: 405 });

        const reqHeaders = Object.fromEntries(req.headers.entries());
        
        const reqBody = await req.json();

        return await new Promise(async (ok, err) => {
          try {
            await handler({
              request: req,
              body: reqBody,
              response: null,
              headers: reqHeaders,
            }, response => {
              let body = response.body;
              const headers = new Headers();

              if (response.headers) {
                for (const key in response.headers) {
                  headers.set(key, response.headers[key]);
                }
              }

              if ('string' !== typeof body) {
                body = JSON.stringify(body);
                headers.set('content-type', 'application/json');
              }

              if (response.files) {
                const form = new MultipartData();
                headers.set('content-type', `multipart/form-data; boundary=${form.boundary}`);

                form.attach('payload_json', body);
                for (const file of response.files) form.attach(file.name, file.file, file.name);

                body = Buffer.concat(form.finish());
              }

              ok(new Response(body, { headers, status: response.status }));
            });
          } catch (error) {
            err(error);
          }
        });
      },
    });
  }
};