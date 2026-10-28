// Each way of making a typed array for a new target that is not the constructor that is called, written out for one class at a time, so that every callee and every new target is in sight of the compiler.
// What is made has the prototype of the new target: its constructor, its methods, what instanceof says.
function tell(what, run) {
  try {
    console.log(what, String(run()));
  } catch (error) {
    console.log(what, "threw " + error.constructor.name);
  }
}
class Below1 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(Uint8Array, [2], Below1);
  return [one.length, one instanceof Below1, one instanceof Uint8Array, one.method(), one.constructor === Below1, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below1.prototype].join(" ");
});
class Below2 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct for a class below, a list:", () => {
  const one = Reflect.construct(Uint8Array, [[1, 2]], Below2);
  return [one.length, one instanceof Below2, one instanceof Uint8Array, one.method(), one.constructor === Below2, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below2.prototype].join(" ");
});
class Below3 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct for a bound class below:", () => {
  const one = Reflect.construct(Uint8Array, [2], Below3.bind(null));
  return [one.length, one instanceof Below3, one instanceof Uint8Array, one.method(), one.constructor === Below3, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below3.prototype].join(" ");
});
class Below4 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct for a proxy of a class below:", () => {
  const one = Reflect.construct(Uint8Array, [2], new Proxy(Below4, {}));
  return [one.length, one instanceof Below4, one instanceof Uint8Array, one.method(), one.constructor === Below4, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below4.prototype].join(" ");
});
class Below5 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: from called on a class below:", () => {
  const one = Uint8Array.from.call(Below5, [1, 2]);
  return [one.length, one instanceof Below5, one instanceof Uint8Array, one.method(), one.constructor === Below5, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below5.prototype].join(" ");
});
class Below6 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: of called on a class below:", () => {
  const one = Uint8Array.of.call(Below6, 1, 2);
  return [one.length, one instanceof Below6, one instanceof Uint8Array, one.method(), one.constructor === Below6, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below6.prototype].join(" ");
});
class Below7 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: from, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Uint8Array.from([1, 2]), Below7.prototype);
  return [one.length, one instanceof Below7, one instanceof Uint8Array, one.method(), one.constructor === Below7, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below7.prototype].join(" ");
});
class Below8 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: of, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Uint8Array.of(1, 2), Below8.prototype);
  return [one.length, one instanceof Below8, one instanceof Uint8Array, one.method(), one.constructor === Below8, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below8.prototype].join(" ");
});
class Below9 extends Uint8Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Uint8Array: Reflect.construct, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Reflect.construct(Uint8Array, [2]), Below9.prototype);
  return [one.length, one instanceof Below9, one instanceof Uint8Array, one.method(), one.constructor === Below9, one.constructor === Uint8Array, Object.getPrototypeOf(one) === Below9.prototype].join(" ");
});
function Plain10() {}
Plain10.prototype = { kind: "a plain prototype" };
tell("Uint8Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(Uint8Array, [2], Plain10);
  return [one.length, one.kind, one instanceof Uint8Array, one.constructor === Uint8Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain10.prototype].join(" ");
});
tell("Uint8Array: made by itself beside all those:", () => {
  const one = Reflect.construct(Uint8Array, [2]);
  const other = Uint8Array.from([1, 2]);
  return [one.length, one.constructor === Uint8Array, other.constructor === Uint8Array, Object.getPrototypeOf(other) === Uint8Array.prototype, String(other[1])].join(" ");
});
class Below11 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(Float64Array, [2], Below11);
  return [one.length, one instanceof Below11, one instanceof Float64Array, one.method(), one.constructor === Below11, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below11.prototype].join(" ");
});
class Below12 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct for a class below, a list:", () => {
  const one = Reflect.construct(Float64Array, [[1.5, 2.5]], Below12);
  return [one.length, one instanceof Below12, one instanceof Float64Array, one.method(), one.constructor === Below12, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below12.prototype].join(" ");
});
class Below13 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct for a bound class below:", () => {
  const one = Reflect.construct(Float64Array, [2], Below13.bind(null));
  return [one.length, one instanceof Below13, one instanceof Float64Array, one.method(), one.constructor === Below13, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below13.prototype].join(" ");
});
class Below14 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct for a proxy of a class below:", () => {
  const one = Reflect.construct(Float64Array, [2], new Proxy(Below14, {}));
  return [one.length, one instanceof Below14, one instanceof Float64Array, one.method(), one.constructor === Below14, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below14.prototype].join(" ");
});
class Below15 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: from called on a class below:", () => {
  const one = Float64Array.from.call(Below15, [1.5, 2.5]);
  return [one.length, one instanceof Below15, one instanceof Float64Array, one.method(), one.constructor === Below15, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below15.prototype].join(" ");
});
class Below16 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: of called on a class below:", () => {
  const one = Float64Array.of.call(Below16, 1.5, 2.5);
  return [one.length, one instanceof Below16, one instanceof Float64Array, one.method(), one.constructor === Below16, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below16.prototype].join(" ");
});
class Below17 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: from, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Float64Array.from([1.5, 2.5]), Below17.prototype);
  return [one.length, one instanceof Below17, one instanceof Float64Array, one.method(), one.constructor === Below17, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below17.prototype].join(" ");
});
class Below18 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: of, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Float64Array.of(1.5, 2.5), Below18.prototype);
  return [one.length, one instanceof Below18, one instanceof Float64Array, one.method(), one.constructor === Below18, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below18.prototype].join(" ");
});
class Below19 extends Float64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("Float64Array: Reflect.construct, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Reflect.construct(Float64Array, [2]), Below19.prototype);
  return [one.length, one instanceof Below19, one instanceof Float64Array, one.method(), one.constructor === Below19, one.constructor === Float64Array, Object.getPrototypeOf(one) === Below19.prototype].join(" ");
});
function Plain20() {}
Plain20.prototype = { kind: "a plain prototype" };
tell("Float64Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(Float64Array, [2], Plain20);
  return [one.length, one.kind, one instanceof Float64Array, one.constructor === Float64Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain20.prototype].join(" ");
});
tell("Float64Array: made by itself beside all those:", () => {
  const one = Reflect.construct(Float64Array, [2]);
  const other = Float64Array.from([1.5, 2.5]);
  return [one.length, one.constructor === Float64Array, other.constructor === Float64Array, Object.getPrototypeOf(other) === Float64Array.prototype, String(other[1])].join(" ");
});
class Below21 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct for a class below:", () => {
  const one = Reflect.construct(BigInt64Array, [2], Below21);
  return [one.length, one instanceof Below21, one instanceof BigInt64Array, one.method(), one.constructor === Below21, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below21.prototype].join(" ");
});
class Below22 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct for a class below, a list:", () => {
  const one = Reflect.construct(BigInt64Array, [[1n, 2n]], Below22);
  return [one.length, one instanceof Below22, one instanceof BigInt64Array, one.method(), one.constructor === Below22, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below22.prototype].join(" ");
});
class Below23 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct for a bound class below:", () => {
  const one = Reflect.construct(BigInt64Array, [2], Below23.bind(null));
  return [one.length, one instanceof Below23, one instanceof BigInt64Array, one.method(), one.constructor === Below23, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below23.prototype].join(" ");
});
class Below24 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct for a proxy of a class below:", () => {
  const one = Reflect.construct(BigInt64Array, [2], new Proxy(Below24, {}));
  return [one.length, one instanceof Below24, one instanceof BigInt64Array, one.method(), one.constructor === Below24, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below24.prototype].join(" ");
});
class Below25 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: from called on a class below:", () => {
  const one = BigInt64Array.from.call(Below25, [1n, 2n]);
  return [one.length, one instanceof Below25, one instanceof BigInt64Array, one.method(), one.constructor === Below25, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below25.prototype].join(" ");
});
class Below26 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: of called on a class below:", () => {
  const one = BigInt64Array.of.call(Below26, 1n, 2n);
  return [one.length, one instanceof Below26, one instanceof BigInt64Array, one.method(), one.constructor === Below26, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below26.prototype].join(" ");
});
class Below27 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: from, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(BigInt64Array.from([1n, 2n]), Below27.prototype);
  return [one.length, one instanceof Below27, one instanceof BigInt64Array, one.method(), one.constructor === Below27, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below27.prototype].join(" ");
});
class Below28 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: of, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(BigInt64Array.of(1n, 2n), Below28.prototype);
  return [one.length, one instanceof Below28, one instanceof BigInt64Array, one.method(), one.constructor === Below28, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below28.prototype].join(" ");
});
class Below29 extends BigInt64Array {
  method() {
    return "method of " + this.constructor.name;
  }
}
tell("BigInt64Array: Reflect.construct, and the prototype of a class below later:", () => {
  const one = Object.setPrototypeOf(Reflect.construct(BigInt64Array, [2]), Below29.prototype);
  return [one.length, one instanceof Below29, one instanceof BigInt64Array, one.method(), one.constructor === Below29, one.constructor === BigInt64Array, Object.getPrototypeOf(one) === Below29.prototype].join(" ");
});
function Plain30() {}
Plain30.prototype = { kind: "a plain prototype" };
tell("BigInt64Array: Reflect.construct for a plain function:", () => {
  const one = Reflect.construct(BigInt64Array, [2], Plain30);
  return [one.length, one.kind, one instanceof BigInt64Array, one.constructor === BigInt64Array, one.constructor === Object, Object.getPrototypeOf(one) === Plain30.prototype].join(" ");
});
tell("BigInt64Array: made by itself beside all those:", () => {
  const one = Reflect.construct(BigInt64Array, [2]);
  const other = BigInt64Array.from([1n, 2n]);
  return [one.length, one.constructor === BigInt64Array, other.constructor === BigInt64Array, Object.getPrototypeOf(other) === BigInt64Array.prototype, String(other[1])].join(" ");
});
