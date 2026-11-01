// Atoms belong to a thread. The first comparison in each thread has to meet that thread's atom of the text.
function isCircle(x) {
  return x === "circle";
}
function count() {
  const list = JSON.parse('["circle","square","circle","circles"]');
  let circles = 0;
  for (let turn = 0; turn < 3000; turn++) for (let i = 0; i < list.length; i++) if (isCircle(list[i])) circles++;
  return circles;
}
if (Bun.isMainThread) {
  console.log("main thread:", count());
  const worker = new Worker(new URL(import.meta.url));
  const answer = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
  console.log("the Worker:", answer);
  console.log("main thread again:", count());
  await worker.terminate();
} else {
  postMessage(count());
}
