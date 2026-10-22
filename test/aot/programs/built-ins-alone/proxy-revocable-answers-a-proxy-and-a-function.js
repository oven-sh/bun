const { proxy, revoke } = Proxy.revocable({ size: 1.5 }, {});
console.log(proxy.size + 1);
revoke();
try {
  proxy.size;
} catch (error) {
  console.log(error instanceof TypeError);
}
