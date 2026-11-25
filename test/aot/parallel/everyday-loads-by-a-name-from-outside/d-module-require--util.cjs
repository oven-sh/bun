// Env: NAME_FROM_OUTSIDE=util
function say(m) {
  try {
    console.log("loaded", typeof m, m === null ? "null" : Object.keys(m).length > 3);
    console.log("used", m.format("%s-%d", "a", 1));
  } catch (error) {
    console.log("use threw", error?.code, String(error?.message).slice(0, 200));
  }
}
function refused(error) {
  console.log("load threw", error?.name, error?.code, String(error?.message).slice(0, 200));
}
const name = process.env.NAME_FROM_OUTSIDE;
try {
  say(module.require(name));
} catch (error) {
  refused(error);
}
