// What import() answers is known to nobody; it is a namespace all the same.
export const place = new URL("http://made.up/a");
let text = "no refusal";
async function asks() {
  const self = await import("./a-namespace-that-an-import-call-answers-is-refused-by-a-byte-controller.js");
  new ReadableStream({
    type: "bytes",
    start(controller) {
      try {
        controller.enqueue(self);
      } catch (error) {
        text = `${error}`;
      }
    },
  });
  console.log(`${text.includes("href")} ${text.includes("must be an instance of")}`);
}
queueMicrotask(asks);
