// node:worker_threads: this file starts itself as a Worker, passes workerData, exchanges messages, moves an ArrayBuffer and a MessagePort, and sees the exit code. On one thread: MessageChannel, receiveMessageOnPort and BroadcastChannel.
import { Worker, isMainThread, parentPort, workerData, threadId, MessageChannel, receiveMessageOnPort, BroadcastChannel } from "node:worker_threads";

if (isMainThread) {
  const worker = new Worker(new URL(import.meta.url), { workerData: { start: 10 } });
  // The worker posts both messages and exits in one go, and an event that finds no listener is gone: so nothing is awaited in front of these two.
  const fromWorker = new Promise(resolve => worker.once("message", resolve));
  const exitCode = new Promise(resolve => worker.once("exit", resolve));
  const { port1, port2 } = new MessageChannel();
  const bytes = new Uint8Array([1, 2, 3]);
  worker.postMessage({ bytes, port: port2 }, [bytes.buffer, port2]);
  console.log("moved away:", bytes.length);
  console.log("from the port:", await new Promise(resolve => port1.once("message", resolve)));
  console.log("from the worker:", JSON.stringify(await fromWorker));
  port1.close();
  console.log("the worker ended with:", await exitCode, threadId);

  const channel = new MessageChannel();
  channel.port1.postMessage({ queued: 1 });
  channel.port1.postMessage({ queued: 2 });
  console.log(JSON.stringify(receiveMessageOnPort(channel.port2)), JSON.stringify(receiveMessageOnPort(channel.port2)), receiveMessageOnPort(channel.port2));
  channel.port1.close();

  const sender = new BroadcastChannel("news"), receiver = new BroadcastChannel("news");
  const heard = new Promise(resolve => (receiver.onmessage = event => resolve(event.data)));
  sender.postMessage("broadcast");
  console.log(await heard);
  sender.close();
  receiver.close();
} else {
  parentPort.once("message", ({ bytes, port }) => {
    port.postMessage("sum " + bytes.reduce((sum, byte) => sum + byte, workerData.start));
    port.close();
    parentPort.postMessage({ isMainThread, hasId: threadId > 0 });
    process.exit(7);
  });
}
