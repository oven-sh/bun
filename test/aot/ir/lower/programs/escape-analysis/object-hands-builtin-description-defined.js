// RUN: lower
// OPTIONS: builtin-modules

// Each turn of a loop makes an object whose property cannot be configured. What describes that property is defined on one other object, which takes the second definition only if it is the first one again.
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen setter, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ get x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen getter, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen arrow, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x() { return 1; } });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen method, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.seal({ set x(a) {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("sealed setter, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { set: (a) => {} });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined setter, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { get: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined getter, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.defineProperty({}, "x", { value: () => 1 });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("defined arrow, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: { a: 1 } });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen literal, legacy lookups:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, same key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o)(["x"].join("")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, same variable key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Reflect.ownKeys(source).map((k) => Object.defineProperty(o, k, Object.getOwnPropertyDescriptor(source, k)) === o).join());
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, every own key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "y", Object.getOwnPropertyDescriptor(source, "x")) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, another key:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Reflect.defineProperty(o, "x", Reflect.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, reflect both:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (((d) => Object.defineProperty(o, "x", d) === o)(Object.getOwnPropertyDescriptor(source, "x")));
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, held in a variable:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperties(o, Object.getOwnPropertyDescriptors(source)) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.getOwnPropertyDescriptors(source).x) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, one of all descriptors:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "x", { ...Object.getOwnPropertyDescriptor(source, "x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, a copy of the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "x", Object.create(Object.getOwnPropertyDescriptor(source, "x"))) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, below the descriptor:" + out);
  }
  scene();
}
{
  function scene() {
    const o = {};
    let out = "";
    for (let i = 0; i < 2; i++) {
      const source = Object.freeze({ x: [1] });
      try {
        out += " " + (Object.defineProperty(o, "x", { get: source.__lookupGetter__("x"), set: source.__lookupSetter__("x") }) === o);
      } catch (e) {
        out += " threw " + (e instanceof TypeError);
      }
    }
    console.log("frozen list, legacy lookups:" + out);
  }
  scene();
}

// GENERATED: get
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Integer integer=1
// CHECK-NEXT: v1 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
