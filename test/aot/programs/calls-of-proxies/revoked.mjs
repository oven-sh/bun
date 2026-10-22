// A call of a Proxy answers as in plain Bun: revoked.
const { proxy, revoke } = Proxy.revocable(function () { return 1; }, {}); console.log(proxy()); revoke(); try { proxy(); } catch (e) { console.log(e.name, e.message); }
