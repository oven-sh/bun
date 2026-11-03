// The method under Symbol.for("nodejs.util.inspect.custom") by which a class of the host prints itself is native code that calls the printer of node:util. A program may call it as the formatter does.
// Only texts are printed here, so nothing but the calls by hand needs the printer.
const custom = Symbol.for("nodejs.util.inspect.custom");

function show(name, make) {
  try {
    const object = make();
    const method = object[custom];
    console.log(String(name + ": " + typeof method + " " + (typeof method === "function" ? String(method.call(object, 2, {})).split("\n")[0] : "-")));
  } catch (error) {
    console.log(String(name + " threw " + error.constructor.name + ": " + error.message.slice(0, 60)));
  }
}

show("URLSearchParams", () => new URLSearchParams("a=1&b=2"));
show("URL", () => new URL("https://example.com/a"));
show("ReadableStream", () => new ReadableStream());
show("WritableStream", () => new WritableStream());
show("TransformStream", () => new TransformStream());
show("the body of a Response", () => new Response("x").body);
show("a reader", () => new ReadableStream().getReader());
show("TextDecoderStream", () => new TextDecoderStream());
show("a mark", () => performance.mark("m"));
show("Buffer", () => Buffer.from("ab"));
show("Headers", () => new Headers({ a: "1" }));
show("Blob", () => new Blob(["x"]));
show("an object literal", () => ({}));

const { [custom]: print } = URL.prototype;
console.log(String(typeof print + " " + print.call(new URL("https://example.com/a?b=c"), 1, {}).length));
