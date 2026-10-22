const result = process.cpuUsage();
console.log(typeof result, Object.keys(result).join(), typeof result.user, typeof result.system);
