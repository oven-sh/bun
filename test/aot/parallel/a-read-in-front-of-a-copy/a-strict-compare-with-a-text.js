const log = [];
function record(event) {
  if (event.level === "debug") return;
  log.push({ ...event });
}
record({ level: "info", msg: "a" });
record({ level: "warn", code: 3 });
console.log(JSON.stringify(log));
