var unseen = new Function("x", "return x");
var noted = [];
function notingProxy(target) {
  return new Proxy(target, {
    set: function (target, key, value, receiver) {
      noted.push("trap " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
  });
}
function report(name, make) {
  for (var round = 0; round < 4; round++) {
    var made = make(round);
    console.log(name, round, JSON.stringify(made), noted.join());
    noted.length = 0;
  }
}

function Base1() {}
function Made1(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Made1.prototype = new Base1();
Object.setPrototypeOf(unseen(Made1).prototype, notingProxy(Base1.prototype));
report("new of an unseen function", function (x) { return new (unseen(Made1))(x); });

function Base2() {}
function Made2(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Made2.prototype = new Base2();
Object.setPrototypeOf(unseen(Made2).prototype, notingProxy(Base2.prototype));
report("Reflect.construct", function (x) { return Reflect.construct(Made2, [x]); });

function Base3() {}
function Made3(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Made3.prototype = new Base3();
Object.setPrototypeOf(unseen(Made3).prototype, notingProxy(Base3.prototype));
function Below3(x) { Made3.call(this, x); this.d = x + 3; }
Below3.prototype = Object.create(Made3.prototype);
report("a constructor function below", function (x) { return new Below3(x); });

function Base4() {}
function Made4(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Made4.prototype = new Base4();
Object.setPrototypeOf(unseen(Made4).prototype, notingProxy(Base4.prototype));
class Below4 extends Made4 { constructor(x) { super(x); this.d = x + 3; } }
report("a class below", function (x) { return new Below4(x); });

function Base5() {}
function Made5(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Object.setPrototypeOf(Made5.prototype, Base5.prototype);
Object.setPrototypeOf(unseen(Base5).prototype, notingProxy({}));
report("the proxy above the parent", function (x) { return new Made5(x); });

function Made6(x) { this.a = x; this.b = x + 1; this.c = x + 2; }
Object.setPrototypeOf(unseen(Made6).prototype, notingProxy({}));
report("no parent", function (x) { return new Made6(x); });
