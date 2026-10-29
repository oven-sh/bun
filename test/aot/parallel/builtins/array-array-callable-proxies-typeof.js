// Array.isArray of callable proxies, live and revoked, behind `typeof value === "function"`: in place, of a parameter, in a callback, in a loop, and where nobody uses the answer.
const { proxy: revoked, revoke } = Proxy.revocable(() => {}, {});
const live = new Proxy(function () {}, {});
const inner = Proxy.revocable(function () {}, {});
const aroundRevoked = new Proxy(inner.proxy, {});
const revokedClass = Proxy.revocable(class {}, {});
revoke();
inner.revoke();
revokedClass.revoke();

try {
  if (typeof revoked === "function") console.log("in place", Array.isArray(revoked));
} catch (error) {
  console.log("in place", error.name, error.message);
}
if (typeof live === "function") console.log("in place, live", Array.isArray(live));
try {
  if (typeof aroundRevoked === "function") console.log("in place, around", Array.isArray(aroundRevoked));
} catch (error) {
  console.log("in place, around", error.name, error.message);
}

const values = [revoked, live, aroundRevoked, revokedClass.proxy, () => {}, class {}, Math.max, [1], new Proxy([1], {}), { length: 1 }, "text", null, undefined];

function ofParameter(value) {
  if (typeof value === "function") return Array.isArray(value);
  return "no function";
}
function behindNotObject(value) {
  if (typeof value !== "object") return Array.isArray(value);
  return "an object";
}
function ofFunctionOrList(value) {
  if (typeof value === "function" || Array.isArray(value)) return Array.isArray(value) ? value.length : "a function";
  return "neither";
}
function unused(value) {
  if (typeof value === "function") Array.isArray(value);
  return "came back";
}
function inLoop(value) {
  let count = 0;
  for (let turn = 0; turn < 3; turn++) if (typeof value === "function" && !Array.isArray(value)) count++;
  return count;
}
function byCall(value) {
  if (typeof value === "function") return Array.isArray.call(null, value);
  return "no function";
}
function byReflect(value) {
  if (typeof value === "function") return Reflect.apply(Array.isArray, null, [value]);
  return "no function";
}
for (const ask of [ofParameter, behindNotObject, ofFunctionOrList, unused, inLoop, byCall, byReflect]) {
  values.forEach((value, index) => {
    try {
      console.log(ask.name, index, ask(value));
    } catch (error) {
      console.log(ask.name, index, error.name, error.message);
    }
  });
}

values.forEach((value, index) => {
  try {
    if (typeof value === "function") console.log("callback", index, Array.isArray(value));
  } catch (error) {
    console.log("callback", index, error.name, error.message);
  }
});
