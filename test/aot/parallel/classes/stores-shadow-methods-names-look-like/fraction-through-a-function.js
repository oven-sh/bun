class Base { "1.5"() { return "base"; } } class A extends Base {} function put(p, k, v) { p[k] = v; } put(A.prototype, 1.5, () => "shadow"); const a = new A(); console.log(a[1.5](), a["1.5"]());
