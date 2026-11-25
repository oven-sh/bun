// Under: --aot-testing=CheckEffectsAtRunTime: the first call of a member of process creates its function, and the check took that for an effect of the call
const before = process.cpuUsage();
const { user, system } = process.cpuUsage(before);
console.log(typeof user, typeof system);
console.log(typeof process.resourceUsage().maxRSS);

let records = 0;
for (let i = 0; i < 20; i++) {
  if (typeof process.threadCpuUsage().user === "number") records++;
  if (typeof process.resourceUsage().userCPUTime === "number") records++;
}
console.log(records);
