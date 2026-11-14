// JSTextDecoderStream.cpp: the chunk is refused in a later job, by the native transformer: what has no constructor is printed whole there, with the address in it.
const url = new URL("http://made.up/a");
const list = [url];
list.constructor = undefined;
const { readable, writable } = new TextDecoderStream();
const writer = writable.getWriter();
const written = writer.write(list).then(
  () => "no refusal",
  error => `${error}`,
);
readable.getReader().read().catch(() => {});
const text = await written;
console.log(`SAID ${text.includes("href")} ${text.includes("chunk")}`);
