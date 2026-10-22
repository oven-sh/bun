function install(root, name, value) { root[name] = value; }
[install].forEach(each => each(globalThis, "__installed", () => "installed"));
(function (root) { root.__umd = { version: 3 }; })(typeof self !== "undefined" ? self : this);
console.log(globalThis.__installed(), globalThis.__umd.version);
