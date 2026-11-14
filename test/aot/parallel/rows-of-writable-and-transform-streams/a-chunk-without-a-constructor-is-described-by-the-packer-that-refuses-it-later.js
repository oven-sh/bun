// JSCompressionStreamShared.cpp :128 :140 :151, through a pipe.
const url = new URL("http://made.up/a");
const list = [url];
list.constructor = undefined;
const source = new ReadableStream({
  start(controller) {
    controller.enqueue(list);
    controller.close();
  },
});
let text = "no refusal";
try {
  await source.pipeThrough(new CompressionStream("gzip")).getReader().read();
} catch (error) {
  text = `${error}`;
}
console.log(`SAID ${text.includes("href")} ${text.includes("chunk")}`);
