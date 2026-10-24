// server.fetch(url, options) reads method, headers and body of its second operand, which runs the getters and conversions of the program.
let gettersRun = 0;
let conversionsRun = 0;

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    return new Response(`${request.method} ${request.headers.get("x-from-init")} ${await request.text()}`);
  },
});

const init = {
  get method() {
    gettersRun++;
    return {
      toString() {
        conversionsRun++;
        return "POST";
      },
    };
  },
  get headers() {
    gettersRun++;
    return { "x-from-init": "yes" };
  },
  get body() {
    gettersRun++;
    return "the body";
  },
};

type FetchWithInit = (url: string, init: object) => Promise<Response>;
const response = await (server.fetch as FetchWithInit).call(server, "/path", init);
console.log(await response.text());
console.log(gettersRun, conversionsRun);
server.stop(true);
