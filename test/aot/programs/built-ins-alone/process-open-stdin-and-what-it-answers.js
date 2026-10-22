const result = process.openStdin();
console.log(typeof result, Object.keys(result).join(), typeof result.fd, typeof result.start, result.start === undefined);
console.log(typeof result.end, typeof result.pos, result.pos === undefined);
