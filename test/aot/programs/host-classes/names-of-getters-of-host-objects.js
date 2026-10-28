// Prints the name and the length of getters and setters of Buffer.prototype, of streams and of other host classes.
const show = (label, holder, key) => {
  const { get, set } = Object.getOwnPropertyDescriptor(holder, key);
  console.log(label, String(key), JSON.stringify([get?.name, get?.length, set?.name, set?.length]));
};
show("Buffer.prototype", Buffer.prototype, "parent");
show("Buffer.prototype", Buffer.prototype, "offset");
show("ReadableStream.prototype", ReadableStream.prototype, "locked");
show("ReadableStreamDefaultReader.prototype", ReadableStreamDefaultReader.prototype, "closed");
show("WritableStream.prototype", WritableStream.prototype, "locked");
show("TransformStream.prototype", TransformStream.prototype, "readable");
show("Request.prototype", Request.prototype, "url");
show("Blob.prototype", Blob.prototype, "size");
console.log(Buffer.alloc(2).parent.byteLength > 0, Buffer.alloc(2).offset >= 0, new ReadableStream().locked);
