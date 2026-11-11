// The two functions list all their members, and a program may still lay one of its own or write over the one that is there.
function ask(holder) {
  return typeof holder.made + " " + typeof holder.bigint;
}
console.log(ask(process.hrtime));
process.hrtime.made = () => "made up";
console.log(ask(process.hrtime), process.hrtime.made());
process.hrtime.bigint = () => "written over";
console.log(process.hrtime.bigint());
Function.prototype.above = "laid above";
console.log(process.memoryUsage.above, process.memoryUsage.rss.above);
delete process.memoryUsage.rss;
console.log(typeof process.memoryUsage.rss);
