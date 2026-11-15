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
const optional = "node:" + process.env.NAME_FROM_OUTSIDE;
const m = await import(optional).catch(() => null);
if (m === null) console.log("the import answered null");
else say(m.default ?? m);
