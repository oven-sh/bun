const result = process.memoryUsage();
console.log(typeof result, Object.keys(result).join(), typeof result.rss, typeof result.heapTotal, typeof result.heapUsed);
console.log(typeof result.external);
