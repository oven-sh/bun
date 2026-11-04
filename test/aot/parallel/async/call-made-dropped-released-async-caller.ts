// What a call made and dropped is released while its async caller waits.
async function keptOnceTheRestIsCollected<T>(label: string, make: (track: (blob: Blob) => Blob) => T): Promise<T> {
  let tracked = 0;
  let collected = 0;
  const registry = new FinalizationRegistry(() => collected++);
  const kept = make(blob => {
    tracked++;
    registry.register(blob, undefined);
    return blob;
  });
  let rounds = 0;
  while (collected < tracked && rounds < 300) {
    Bun.gc(true);
    await Bun.sleep(0);
    rounds++;
  }
  console.log(label, collected < tracked ? "is still held" : "was collected");
  registry.unregister(registry);
  return kept;
}

const texts = ["one", "two", "three"];
for (const round of [1, 2]) {
  const stream = await keptOnceTheRestIsCollected("round " + round + ": the Blob whose stream is kept", track => track(new Blob(texts)).stream());
  console.log(await Bun.readableStreamToText(stream));
}
