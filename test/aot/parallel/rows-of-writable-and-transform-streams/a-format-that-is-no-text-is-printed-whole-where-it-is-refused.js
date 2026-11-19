// JSCompressionStreamShared.cpp :47.
const said = [];
for (const make of [
  () => new CompressionStream("made up"),
  () => new DecompressionStream({ at: new URL("http://made.up/a"), toString: () => "made up" }),
  () => new CompressionStream(),
  () => new CompressionStream("gzip", { level: 99 }),
  () => new TextDecoderStream("made up"),
  () => new TextDecoderStream("utf-8", 1),
]) {
  try {
    make();
    said.push("made");
  } catch (error) {
    said.push(`${error.name} ${error.code} ${error.message.includes("href")}`);
  }
}
console.log(`${said.join(" | ")}`);
const decoder = new TextDecoderStream("latin1", { fatal: true, ignoreBOM: 1 });
console.log(`${decoder.encoding} ${decoder.fatal} ${decoder.ignoreBOM} ${decoder.readable instanceof ReadableStream} ${decoder.writable instanceof WritableStream}`);
