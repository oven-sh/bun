class Handler { get(target, name) { return "got " + String(name); } has() { return true; } ownKeys() { return ["a"]; } getOwnPropertyDescriptor() { return { value: 1, enumerable: true, configurable: true }; } }
const proxy = new Proxy({}, new Handler()); console.log(proxy.x, "y" in proxy, Object.keys(proxy).join());
