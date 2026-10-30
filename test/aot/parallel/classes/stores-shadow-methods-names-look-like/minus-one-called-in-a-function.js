class Base { [-1]() { return "base"; } } class A extends Base {} A.prototype[-1] = () => "shadow"; function call(o) { return o[-1](); } console.log(call(new A()), call(new Base()));
