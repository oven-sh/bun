import { aborted, first, type Payload } from "./library.js";
const payloads: Payload[] = [
  { value: 1, issues: [] },
  { value: 2, issues: [{ stops: false }, { stops: true }] },
];
let count = 0;
for (let turn = 0; turn < 1000; turn++) for (const payload of payloads) if (aborted(first(payload))) count++;
console.log(count);
