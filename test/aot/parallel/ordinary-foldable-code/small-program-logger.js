const LEVELS = ["debug", "info", "warn", "error"];
const MIN_LEVEL = "info";
const DEBUG = false;
function log(level, message) {
  if (LEVELS.indexOf(level) < LEVELS.indexOf(MIN_LEVEL)) return;
  console.log(`[${level.toUpperCase()}] ${message}`);
}
log("debug", "hidden");
log("info", "shown");
log("error", "also shown");
if (DEBUG) log("info", "never");
