// Revoked proxies that are called and constructed, and recursion without end through missing arguments and through a getter.
const attempt = (f: () => unknown) => {
  try {
    f();
    return "none";
  } catch (e) {
    return (e as Error).constructor.name;
  }
};
const revoked = () => {
  const { proxy, revoke } = Proxy.revocable(function () {}, {});
  revoke();
  return proxy as any;
};
function tooFewArguments(a?: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any): number {
  return 1 + recurse();
}
function recurse(): number {
  return 1 + tooFewArguments(1);
}
const withGetter = {
  get next(): unknown {
    return withGetter.next;
  },
};
console.log(
  attempt(() => revoked()()),
  attempt(() => new (revoked())()),
  attempt(recurse),
  attempt(() => withGetter.next),
);
