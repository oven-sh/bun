const subject = new Intl.Segmenter("en").segment("ab")[Symbol.iterator]();
const result = subject.next();
console.log(typeof result, Object.keys(result).join(), typeof result.value, Object.keys(result.value).join());
console.log(typeof result.value.segment, result.value.segment.length, result.value.segment);
console.log(typeof result.value.index, result.value.index + 1, 1 / result.value.index);
console.log(typeof result.value.input, result.value.input.length, result.value.input, typeof result.done, result.done);
