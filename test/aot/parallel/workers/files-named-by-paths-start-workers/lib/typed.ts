interface Answer { from: string; sum: number }
const answer: Answer = { from: import.meta.file, sum: [1, 2, 3].reduce((a: number, b: number) => a + b, 0) };
postMessage(answer);
