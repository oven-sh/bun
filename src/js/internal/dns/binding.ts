// The natives behind the callback forms of `node:dns`. `node:dns` reads each from this object when it calls it,
// and `bun:internal-for-testing` hands the object to a test that replaces one, as Node's tests replace a function
// of `internalBinding("cares_wrap")`.
export default $bindgen("node_dns_binding.bind.ts", "callbackForms");
