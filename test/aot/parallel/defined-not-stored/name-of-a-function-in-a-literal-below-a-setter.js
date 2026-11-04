const made = { named: function () {}, arrow: () => {}, method() {}, get read() { return 1; }, ["comp" + "uted"]: function () {}, klass: class {} };
console.log(made.named.name, made.arrow.name, made.method.name, Object.getOwnPropertyDescriptor(made, "read").get.name, made.computed.name, made.klass.name);
