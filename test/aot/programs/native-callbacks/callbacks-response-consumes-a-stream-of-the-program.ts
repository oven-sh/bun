// Callbacks handed over: Response, Bun.readableStreamToArray and Bun.readableStreamToText pull a stream whose source is a class instance of the program; the chunks, of any type, come back to the program or make the host reject.
export {};

let total = 0;

class Source {
  constructor(public chunks: unknown[]) {}
  pull(controller: number): void {
    total += typeof controller === "number" ? 1 : 100;
    const real = controller as unknown as ReadableStreamDefaultController<unknown>;
    if (this.chunks.length) real.enqueue(this.chunks.shift());
    else real.close();
  }
}

function called(value: number): void {
  total += typeof value === "number" ? 10000 : 1000000;
}

new Source([]).pull.length;
called(1);
const stream = (...chunks: unknown[]): ReadableStream<any> => new ReadableStream(new Source(chunks) as any);
const outcome = async (promise: Promise<unknown>): Promise<string> => promise.then(value => typeof value + ":" + String(value).length, error => "rejected:" + (error as Error).name);
const results = [
  await outcome(new Response(stream("a", new TextEncoder().encode("b"))).text()),
  await outcome(new Response(stream(5)).text()),
  await outcome(new Response(stream({ plain: true })).arrayBuffer()),
  await outcome(new Response(stream('{"a":', "1}")).json()),
  await outcome(Bun.readableStreamToText(stream("x", "y"))),
];
const chunks = await Bun.readableStreamToArray(stream(called, 7, "s"));
chunks[0]("text");
console.log(total, results.join(), chunks.map(one => typeof one).join());
