// A proxy of an object that is no function is no function. The error names the callee as the call is written.
const revoked = Proxy.revocable(() => 1, {});
revoked.revoke();
const list = [
  new Proxy({}, {}),
  new Proxy([], {}),
  new Proxy(new Proxy({}, {}), {}),
  new Proxy(() => "called", {}),
  new Proxy(new Proxy(() => "called through two", {}), {}),
  revoked.proxy,
];
function say(call) {
  try {
    console.log(call());
  } catch (error) {
    console.log(error.name + ": " + error.message);
  }
}
for (const callee of list) {
  say(() => {
    const result = callee();
    return result;
  });
  say(() => callee());
  const holder = { member: callee };
  say(() => {
    const result = holder.member();
    return result;
  });
}
