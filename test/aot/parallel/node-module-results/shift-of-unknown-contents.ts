import { basename } from "node:path";

const queue: any[] = [basename("a/b"), { n: 1 }, 3];
let sum = 0;
for (let i = 0; i < 4; i++) sum += (queue.shift() as number) & 255;
const anything: any[] = JSON.parse('[1, "2", {"a": 3}, 260]');
for (let i = 0; i < 4; i++) sum += anything.pop() | 1;
console.log(sum);
