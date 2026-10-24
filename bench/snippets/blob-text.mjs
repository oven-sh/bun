// Time of blob.text() and blob.json() for a Blob made from bytes: read again, read through a new handle, read in parts.
// text() and json() scan the bytes for non-ASCII once, then cache the answer for the Blob, and for the bytes when the
// Blob spans all of them. Each case prints the fastest and the median of 300 samples of 16 runs. A large text() makes
// garbage, so the median of those cases also counts the collector.
const KiB = 1024;
const MiB = 1024 * KiB;
const ascii = size => new Uint8Array(size).fill(97);
const notAscii = size => {
  const bytes = ascii(size);
  bytes.set([0xc3, 0xa9], size >> 1);
  return bytes;
};
const format = ms => {
  const ns = ms * 1e6;
  return (ns < 1000 ? ns.toFixed(0) + " ns" : (ns / 1000).toFixed(2) + " us").padStart(11);
};

async function measure(name, run) {
  for (let i = 0; i < 64; i++) await run();
  const samples = [];
  for (let sample = 0; sample < 300; sample++) {
    const start = performance.now();
    for (let i = 0; i < 16; i++) await run();
    samples.push((performance.now() - start) / 16);
  }
  samples.sort((a, b) => a - b);
  console.log(`${name.padEnd(66)} ${format(samples[0])} fastest ${format(samples[150])} median`);
}

for (const [label, size] of [
  ["64 B", 64],
  ["64 KiB", 64 * KiB],
  ["1 MiB", MiB],
]) {
  {
    const blob = new Blob([ascii(size)]);
    await measure(`text() again (${label}, ASCII)`, () => blob.text());
  }
  {
    // Each Response reads through its own handle, which has no answer of its own.
    const blob = new Blob([ascii(size)]);
    await measure(`new Response(blob).text() (${label}, ASCII)`, () => new Response(blob).text());
  }
  if (size > 64) {
    const blob = new Blob([ascii(size)]);
    await measure(`slice(0, 64).text() (${label}, ASCII, Blob never read whole)`, () => blob.slice(0, 64).text());
  }
  {
    const blob = new Blob([notAscii(size)]);
    await measure(`text() again (${label}, one non-ASCII character)`, () => blob.text());
  }
  {
    const bytes = ascii(size);
    await measure(`new Blob([bytes]).text() (${label}, ASCII)`, () => new Blob([bytes]).text());
  }
  {
    const bytes = notAscii(size);
    await measure(`new Blob([bytes]).text() (${label}, one non-ASCII character)`, () => new Blob([bytes]).text());
  }
}

{
  const blob = new Blob([ascii(MiB)]);
  await measure("16 x slice(i, i + 64 KiB).text() (1 MiB, ASCII, never read whole)", async () => {
    for (let i = 0; i < MiB; i += 64 * KiB) await blob.slice(i, i + 64 * KiB).text();
  });
}

if (Blob.prototype.json) {
  const bytes = new TextEncoder().encode(JSON.stringify(Array.from({ length: 8 * KiB }, (_, i) => i)));
  const label = `${(bytes.length / KiB).toFixed(0)} KiB, ASCII`;
  {
    const blob = new Blob([bytes]);
    await measure(`json() again (${label})`, () => blob.json());
  }
  {
    const blob = new Blob([bytes]);
    await measure(`new Response(blob).json() (${label})`, () => new Response(blob).json());
  }
}
