// A store of what is no text into the environment is warned of, and nobody follows where the field of the class is stored. The printer of warnings is compiled for that, and nothing else of the library.
// STATISTIC: ImageFunctionsEmitted <= 60
class Refused extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const server = Bun.serve({
  port: Number(process.env.MADE_UP_PORT ?? 0),
  fetch(request) {
    try {
      if (request.method === "PUT") throw new Refused(400, "made up");
      return new Response("taken");
    } catch (error) {
      return new Response((error as Refused).message, { status: (error as Refused).status });
    }
  },
});
server.stop();
console.log("stopped");
