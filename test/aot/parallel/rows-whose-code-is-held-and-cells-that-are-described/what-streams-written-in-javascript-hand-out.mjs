const answer = new Response("some text");
const reader = answer.body.getReader();
console.log(reader.constructor.name, typeof reader.read, typeof reader.releaseLock, Object.prototype.toString.call(reader));
const step = await reader.read();
console.log(step.done, step.value.constructor.name, step.value.length, Object.keys(step).join());
const [left, right] = new Response("twice").body.tee();
console.log(left.constructor.name, right instanceof ReadableStream, await new Response(left).text(), await Bun.readableStreamToText(right));
