const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const attempt = (label, text, read) => {
  let how = "stored";
  try {
    (0, eval)(text.join(" "));
  } catch (error) {
    how = `${error.constructor.name}: ${error.message.split(" because ")[0]}`;
  }
  console.log(`${label}: ${how} | ${read()}`);
};

globalThis.url = Bun.pathToFileURL("/a");
attempt("URL.canParse", ["url.constructor.canParse", "= () => 'mine'"], () => URL.canParse("x:y"));

globalThis.load = import.meta.require;
attempt("Bun.pathToFileURL", ["load('bun').pathToFileURL", "= () => 'mine'"], () => Bun.pathToFileURL("/a"));

globalThis.instant = Temporal.Now.instant();
attempt("Temporal.Instant.compare", ["instant.constructor.compare", "= () => 'mine'"], () =>
  Temporal.Instant.compare(instant, instant),
);

globalThis.duration = instant.since(instant);
attempt("Temporal.Duration.compare", ["duration.constructor.compare", "= () => 'mine'"], () =>
  Temporal.Duration.compare(duration, duration),
);

globalThis.compiled = (await WebAssembly.instantiate(bytes)).module;
attempt("WebAssembly.Module.exports", ["compiled.constructor.exports", "= () => 'mine'"], () =>
  WebAssembly.Module.exports(compiled).length,
);

globalThis.signal = new AbortController().signal;
attempt("AbortSignal.abort", ["signal.constructor.abort", "= () => 'mine'"], () => AbortSignal.abort());

globalThis.stream = new Blob(["x"]).stream();
attempt("ReadableStream.from", ["delete", "stream.constructor.from"], () => typeof ReadableStream.from);

attempt(
  "URL.parse",
  ["Object.defineProperty(Object.getPrototypeOf(url).constructor,", "'parse', { value: () => 'mine' })"],
  () => URL.parse("x:y"),
);

/* Output:
URL.canParse: TypeError: Cannot assign to URL.canParse | true
Bun.pathToFileURL: TypeError: Cannot assign to Bun.pathToFileURL | file:///a
Temporal.Instant.compare: TypeError: Cannot assign to Temporal.Instant.compare | 0
Temporal.Duration.compare: TypeError: Cannot assign to Temporal.Duration.compare | 0
WebAssembly.Module.exports: TypeError: Cannot assign to WebAssembly.Module.exports | 0
AbortSignal.abort: TypeError: Cannot assign to AbortSignal.abort | [object AbortSignal]
ReadableStream.from: TypeError: Cannot delete ReadableStream.from | function
URL.parse: TypeError: Cannot assign to URL.parse | x:y
*/
