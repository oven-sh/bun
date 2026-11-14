const first = new AbortController();
const both = AbortSignal.any([first.signal, new AbortController().signal]);
first.abort([1, 2, 3]);
console.log(both.reason.length, both.reason[2], String(both.reason === first.signal.reason));
