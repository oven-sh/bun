// A built-in stores into a static field through the class object, inside the loop that reads the field: the read after the call sees the new value.
class First { static value = 1 }
let held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(First, { value: 7 });
  if (First.value + 1 === 2) held++;
}
console.log(held, First.value);
class Second { static value = 1 }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(Second, { value: undefined });
  if (Second.value + 1 === 2) held++;
}
console.log(held, Second.value);
class C1 { static value = 1; static other = 1 }
held = 0;
for (let i = 0; i < 2000; i++) {
  const key = i % 2 ? "value" : "other";
  if (i >= 1000) C1[key] = 7;
  if (C1.value + 1 === 2) held++;
}
console.log(held, C1.value, C1.other);
class C2 { static value = 1 }
held = 0;
const source = { value: 3 };
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(C2, source);
  if (C2.value + 1 === 2) held++;
}
console.log(held, C2.value);
class C3 { static value = 1 }
class C4 extends C3 {}
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(C3, { value: 9 });
  if (C4.value + 1 === 2) held++;
}
console.log(held, C4.value);
class C5 { static value = 1; static read() { return this.value + 1; } }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(C5, { value: null });
  if (C5.read() === 2) held++;
}
console.log(held, C5.value);
class C6 { static list = [1] }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.assign(C6, { list: [] });
  if (C6.list.length === 1) held++;
}
console.log(held, C6.list.length);
class C11 { static value = 1 }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Reflect.set(C11, "value", undefined);
  if (C11.value + 1 === 2) held++;
}
console.log(held);
class C12 { static value = 1 }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.defineProperty(C12, "value", { value: undefined });
  if (C12.value + 1 === 2) held++;
}
console.log(held);
class C13 { static value = 1 }
held = 0;
for (let i = 0; i < 2000; i++) {
  if (i === 1000) Object.defineProperties(C13, { value: { value: undefined } });
  if (C13.value + 1 === 2) held++;
}
console.log(held);
class C14 { static value = 1 }
held = 0;
const key = ["va", "lue"].join("");
for (let i = 0; i < 2000; i++) {
  if (i === 1000) C14[key] = undefined;
  if (C14.value + 1 === 2) held++;
}
console.log(held);
