// One question: built alone, it prints as plain Bun does.
const url = new URL("http://made.up/a"); let text = "no refusal";
const list = [url]; list.constructor = undefined;
new ReadableStream({ type: "bytes", start(controller) { try { controller.enqueue(list); } catch (error) { text = `${error}`; } } });
console.log(`${text.includes("href")} ${text.slice(90, 170)}`);
