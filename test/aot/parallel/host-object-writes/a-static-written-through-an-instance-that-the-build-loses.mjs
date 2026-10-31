const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const hide = value => new CustomEvent("x", { detail: value }).detail;
const attempt = (label, write, read) => {
  let how = "stored";
  try {
    write();
  } catch (error) {
    how = `${error.constructor.name}: ${error.message.split(" because ")[0]}`;
  }
  console.log(`${label}: ${how} | ${read()}`);
};

attempt(
  "URL.canParse",
  () => (hide(Bun.pathToFileURL("/a")).constructor.canParse = () => "mine"),
  () => URL.canParse("x:y"),
);

const instant = Temporal.Now.instant();
attempt(
  "Temporal.Instant.compare",
  () => (hide(instant).constructor.compare = () => "mine"),
  () => Temporal.Instant.compare(instant, instant),
);

attempt(
  "AbortSignal.abort",
  () => (hide(new AbortController().signal).constructor.abort = () => "mine"),
  () => AbortSignal.abort(),
);

const { module } = await WebAssembly.instantiate(bytes);
attempt(
  "WebAssembly.Module.exports",
  () => (module.constructor.exports = () => "mine"),
  () => WebAssembly.Module.exports(module).length,
);

/* Output:
URL.canParse: TypeError: Cannot assign to URL.canParse | true
Temporal.Instant.compare: TypeError: Cannot assign to Temporal.Instant.compare | 0
AbortSignal.abort: TypeError: Cannot assign to AbortSignal.abort | [object AbortSignal]
WebAssembly.Module.exports: TypeError: Cannot assign to WebAssembly.Module.exports | 0
*/
