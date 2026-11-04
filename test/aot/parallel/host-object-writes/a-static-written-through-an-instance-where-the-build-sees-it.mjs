const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
const mine = () => "mine";
const attempt = (label, write, read) => {
  let how = "stored";
  try {
    write();
  } catch (error) {
    how = `${error.constructor.name}: ${error.message.split(" because ")[0]}`;
  }
  console.log(`${label}: ${how} | ${read()}`);
};
const url = Bun.pathToFileURL("/a");
const never = process.argv.length > 99;

attempt("a store", () => (url.constructor.canParse = mine), () => URL.canParse("x:y"));
attempt("computed keys", () => (url[never ? "x" : "constructor"][never ? "x" : "parse"] = mine), () => URL.parse("x:y"));
attempt("Reflect.set", () => Reflect.set(Object.getPrototypeOf(url).constructor, "createObjectURL", mine), () => URL.createObjectURL(new Blob([])));
attempt("Object.assign", () => Object.assign(url.constructor, { revokeObjectURL: mine }), () => URL.revokeObjectURL("x"));
attempt("require", () => (import.meta.require("bun").pathToFileURL = mine), () => Bun.pathToFileURL("/a"));

const instant = Temporal.Now.instant();
attempt("an instant", () => (instant.constructor.compare = mine), () => Temporal.Instant.compare(instant, instant));
attempt("an instant of a zoned time", () => (Temporal.Now.zonedDateTimeISO().toInstant().constructor.from = mine), () => Temporal.Instant.from("2020-01-01T00:00Z"));

const compiled = await WebAssembly.compile(bytes);
attempt("a compiled module", () => (compiled.constructor.imports = mine), () => WebAssembly.Module.imports(compiled));

const response = await fetch("data:text/plain,x");
attempt("a response", () => (response.constructor.json = mine), () => Response.json({}));
attempt("a definition", () => Object.defineProperty(response.constructor, "error", { value: mine }), () => Response.error());
attempt("the signal of a request", () => (new Request("http://a/").signal.constructor.abort = mine), () => AbortSignal.abort());
attempt("one of a list", () => ([new AbortController().signal, {}][never ? 1 : 0].constructor.any = mine), () => AbortSignal.any([]));
attempt("out of a Map", () => (new Map([[1, new Blob(["x"]).stream()]]).get(1).constructor.from = mine), () => ReadableStream.from([1]));
