const result = process.resourceUsage();
console.log(typeof result, Object.keys(result).join(), typeof result.userCPUTime, typeof result.systemCPUTime, typeof result.maxRSS);
console.log(typeof result.sharedMemorySize);
