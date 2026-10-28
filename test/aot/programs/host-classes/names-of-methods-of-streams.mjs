// Prints the name and the length of every method of the web stream classes, in a program that reads from a stream and writes to one.
const classes = {
  ReadableStream,
  ReadableStreamDefaultReader,
  ReadableStreamBYOBReader,
  ReadableStreamDefaultController,
  ReadableByteStreamController,
  WritableStream,
  WritableStreamDefaultWriter,
  WritableStreamDefaultController,
  TransformStream,
  TransformStreamDefaultController,
  TextEncoderStream,
  TextDecoderStream,
  CompressionStream,
  DecompressionStream,
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
};
for (const [name, constructor] of Object.entries(classes)) {
  console.log(name, JSON.stringify([constructor.name, constructor.length]));
  for (const holder of [constructor, constructor.prototype]) {
    for (const key of Reflect.ownKeys(holder)) {
      const { value, get, set } = Reflect.getOwnPropertyDescriptor(holder, key);
      for (const fn of [value, get, set])
        if (typeof fn === "function") console.log(" ", String(key), JSON.stringify([fn.name, fn.length]));
    }
  }
}
const chunks = [];
const { readable, writable } = new TransformStream();
const writer = writable.getWriter();
writer.write("one");
writer.close();
for await (const chunk of readable) chunks.push(chunk);
console.log(chunks);
