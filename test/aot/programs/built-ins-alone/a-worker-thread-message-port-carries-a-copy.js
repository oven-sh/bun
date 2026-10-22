import { MessageChannel, receiveMessageOnPort } from "node:worker_threads";
const { port1, port2 } = new MessageChannel();
port1.postMessage({ size: 1.5, list: ["two"] });
const received = receiveMessageOnPort(port2);
console.log(received.message.size + 1, received.message.list[0].length, receiveMessageOnPort(port2) === undefined);
port1.close();
