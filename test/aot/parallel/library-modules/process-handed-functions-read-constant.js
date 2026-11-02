// `process` is handed to functions of the program, which read constant names off their parameters and hand it on to each other, and it is kept in a variable. Every use of it is in sight, so the executable holds what those members need and no more.
// STATISTIC: FunctionsLowered <= 600
function describes(source, separator) {
  return join(source, separator).length > 0;
}
function join(source, separator) {
  return [source.platform, source.arch, source.cwd()].join(separator);
}
const pidOf = source => source.pid;
console.log(describes(process, " "), typeof pidOf(process));
let kept;
kept ??= process;
console.log(typeof kept.platform, Object.getPrototypeOf(kept) !== null, Object.keys(kept).length > 10);
const uptime = kept.uptime;
console.log(typeof uptime.call(kept));
