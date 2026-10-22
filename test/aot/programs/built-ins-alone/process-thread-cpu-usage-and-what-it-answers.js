const result = process.threadCpuUsage();
console.log(typeof result, Object.keys(result).join(), typeof result.user, typeof result.system);
