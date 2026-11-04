export function later(log, ms) {
  setTimeout(() => log.push("timeout " + ms), ms);
}
export function often(log, ms) {
  return setInterval(() => log.push("interval " + ms), ms);
}
export function stop(timer) {
  clearInterval(timer);
}
