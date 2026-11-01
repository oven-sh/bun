// What a loop reads is changed inside the loop in a way that names no variable and no field: by a built-in, by a callback of a built-in, under a computed key, through another function. The read behind the change sees the new value.
{
  const C = [1];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, [7]);
    if (C[0] + 1 === 2) held++;
  }
  console.log("array element:", held, C[0]);
}
{
  const C = [1];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { length: 0 });
    if (C.length + 1 === 2) held++;
  }
  console.log("array length:", held, C.length);
}
{
  class C { static value = 1 }
  const toC = Object.assign.bind(null, C);
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) toC({ value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("assign bound:", held, C.value);
}
{
  class C { static value = 1; static other = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { get other() { C.value = 7; return 2; } });
    if (C.value + 1 === 2) held++;
  }
  console.log("assign from getter source:", held, C.value);
}
{
  class C { static value = 1 }
  const assign = Object.assign;
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) assign(C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("assign held in a constant:", held, C.value);
}
{
  class A { static value = 1 }
  class C extends A {}
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("assign on subclass:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign.call(null, C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("assign through call:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.apply(Object.assign, null, [C, { value: 7 }]);
    if (C.value + 1 === 2) held++;
  }
  console.log("assign through reflect apply:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperties(C, Object.fromEntries([["value", { value: 7 }]]));
    if (C.value + 1 === 2) held++;
  }
  console.log("define properties from entries:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.defineProperty(C, "value", { get() { return 7; } });
    if (C.value + 1 === 2) held++;
  }
  console.log("define property getter:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) delete C.value;
    if (C.value + 1 === 2) held++;
  }
  console.log("delete:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) [["value", 7]].forEach(([key, held]) => { C[key] = held; });
    if (C.value + 1 === 2) held++;
  }
  console.log("for each with computed keys:", held, C.value);
}
{
  function C() {}
  C.value = 1;
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("function property:", held, C.value);
}
{
  class K { value = 1 }
  const C = new K();
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("instance field:", held, C.value);
}
{
  const C = { value: 1 };
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("object literal field:", held, C.value);
}
{
  class K {}
  K.prototype.value = 1;
  const C = new K();
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(K.prototype, { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("prototype member:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.defineProperty(C, "value", { value: 7 });
    if (C.value + 1 === 2) held++;
  }
  console.log("reflect define property:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.deleteProperty(C, "value");
    if (C.value + 1 === 2) held++;
  }
  console.log("reflect delete property:", held, C.value);
}
{
  class A { static value = 1 }
  class C extends A {}
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(C, "value", 7);
    if (C.value + 1 === 2) held++;
  }
  console.log("reflect set on subclass:", held, C.value);
}
{
  class A { static value = 1 }
  class B { static value = 7 }
  class C extends A {}
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.setPrototypeOf(C, B);
    if (C.value + 1 === 2) held++;
  }
  console.log("reflect set prototype of:", held, C.value);
}
{
  class C { static value = 1 }
  class D {}
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Reflect.set(D, "value", 7, C);
    if (C.value + 1 === 2) held++;
  }
  console.log("reflect set with receiver:", held, C.value);
}
{
  class A { static value = 1 }
  class B { static value = 7 }
  class C extends A {}
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.setPrototypeOf(C, B);
    if (C.value + 1 === 2) held++;
  }
  console.log("set prototype of:", held, C.value);
}
{
  class C { static value = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) (class { static { C.value = 7; } });
    if (C.value + 1 === 2) held++;
  }
  console.log("static block later class:", held, C.value);
}
{
  class C { static value = 1; static change() { Object.assign(this, { value: 7 }); } }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) C.change();
    if (C.value + 1 === 2) held++;
  }
  console.log("static method assign to this:", held, C.value);
}
{
  class C { static value = 1; static change() { this.value = 7; } }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) C.change();
    if (C.value + 1 === 2) held++;
  }
  console.log("static method through this:", held, C.value);
}
{
  class C { static value = 1 }
  const keys = ["value"];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) keys.map(key => (C[key] = 7));
    if (C.value + 1 === 2) held++;
  }
  console.log("store by key in a callback of map:", held, C.value);
}
{
  class C { static value = 1 }
  function put(key, held) { C[key] = held; }
  const ways = [put, (key, held) => put(key, held)];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) ways[i % 2](["va", "lue"].join(""), 7);
    if (C.value + 1 === 2) held++;
  }
  console.log("store by key in a function called through a list:", held, C.value);
}
{
  class C { static value = 1 }
  const others = [{ value: 0 }, { other: 1, value: 0 }, function () {}, [], new Map()];
  function set(object, held) { object.value = held; }
  for (const other of others) set(other, 3);
  const setters = [set, (object, held) => { object.value = held + 0; }];
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) setters[i % 2](C, 7);
    if (C.value + 1 === 2) held++;
  }
  console.log("store by name through a function that takes other objects:", held, C.value);
}
{
  const tag = Symbol("tag");
  class C { static [tag] = 1 }
  let held = 0;
  for (let i = 0; i < 2000; i++) {
    if (i === 1000) Object.assign(C, { [tag]: 7 });
    if (C[tag] + 1 === 2) held++;
  }
  console.log("symbol key:", held, C[tag]);
}
