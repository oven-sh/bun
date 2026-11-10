import Queue, { limit, isQueue } from "./queue.mjs";
const queue = new Queue();
queue.push(1);
console.log(queue.size, limit, isQueue(queue));
