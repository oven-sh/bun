// `(await body.json()) as Order` goes on in the turn in which `await body.json()` does, also where a stream of the program feeds the body.
// STATISTIC: TypedResultsSelected >= 2
interface Order {
  inner: { x: number };
}
async function ofResponse(body: Response): Promise<number> {
  return ((await body.json()) as Order).inner.x;
}
async function ofRequest(body: Request): Promise<number> {
  return ((await body.json()) as Order).inner.x;
}
async function untyped(body: any): Promise<number> {
  return (await body.json()).inner.x;
}

async function turnsOf(read: () => Promise<number>): Promise<string> {
  let turns = 0;
  let isReading = true;
  const counting = (async () => {
    while (isReading) {
      await null;
      turns++;
    }
  })();
  const answer = await read().catch((error: Error) => error.name);
  const taken = turns;
  isReading = false;
  await counting;
  return answer + " after " + taken;
}

const text = '{"inner":{"x":1}}';
const bytes = new TextEncoder().encode(text);
function inPieces(failsAt: number): ReadableStream {
  let at = 0;
  return new ReadableStream({
    pull(controller) {
      if (at >= failsAt) throw new TypeError("no more");
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, (at += 6)));
    },
  });
}
const bodies: Record<string, () => string | ReadableStream> = {
  "a text": () => text,
  "pieces": () => inPieces(Infinity),
  "pieces cut short": () => new ReadableStream({ pull: controller => (controller.enqueue(bytes.slice(0, 6)), controller.close()) }),
  "a pull that throws at once": () => inPieces(0),
  "a pull that throws later": () => inPieces(6),
  "an error": () => new ReadableStream({ pull: controller => controller.error(new RangeError("no")) }),
  "filled at the start": () => new ReadableStream({ start: controller => (controller.enqueue(bytes), controller.close()) }),
  "strings": () => new ReadableStream({ pull: controller => (controller.enqueue(text), controller.close()) }),
  "a direct stream": () => new ReadableStream({ type: "direct", pull: (controller: any) => (controller.write(bytes), controller.close()) } as any),
  "a stream of a blob": () => new Blob([text]).stream(),
  "a transform": () => new Blob([text]).stream().pipeThrough(new TransformStream()),
};
for (const [name, make] of Object.entries(bodies)) {
  const request = () => new Request("http://localhost/", { method: "POST", body: make() });
  console.log(name + ": response", await turnsOf(() => ofResponse(new Response(make()))), "| untyped", await turnsOf(() => untyped(new Response(make()))));
  console.log(name + ": request", await turnsOf(() => ofRequest(request())), "| untyped", await turnsOf(() => untyped(request())));
}
