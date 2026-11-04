// RUN: lower
// OPTIONS: builtin-modules

// Each block hands a function to another built-in or operator. The function adds one to a count, which the caller prints in front of the call and behind it.
let ran = 0;
console.log("object from entries, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Object.fromEntries(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("object from entries, a field");
{
function scene() {
  class Held {}
  const held = new Held();
  const box = { ran: 0 };
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", box.ran);
  function hook() {
    ++box.ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Object.fromEntries(held);
  } catch (error) {}
  console.log("ran", box.ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("object from entries, a module variable");
{
function scene() {
  class Held {}
  const held = new Held();
  ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Object.fromEntries(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("object from entries, an element");
{
function scene() {
  class Held {}
  const held = new Held();
  const list = [0];
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", list[0]);
  function hook() {
    ++list[0];
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Object.fromEntries(held);
  } catch (error) {}
  console.log("ran", list[0]);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array from, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Array.from(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new map, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Map(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new map, a field");
{
function scene() {
  class Held {}
  const held = new Held();
  const box = { ran: 0 };
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", box.ran);
  function hook() {
    ++box.ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Map(held);
  } catch (error) {}
  console.log("ran", box.ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new map, a module variable");
{
function scene() {
  class Held {}
  const held = new Held();
  ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Map(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new map, an element");
{
function scene() {
  class Held {}
  const held = new Held();
  const list = [0];
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", list[0]);
  function hook() {
    ++list[0];
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Map(held);
  } catch (error) {}
  console.log("ran", list[0]);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new set, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Set(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new weak set, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new WeakSet(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("new uint8 array, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    new Uint8Array(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("promise all, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Promise.all(held).catch(() => {});
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a spread, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    [...held];
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a spread into math max, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    Math.max(...held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a pattern, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    const [first] = held;
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("for of, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.iterator] = hook;
  try {
    for (const each of held) console.log(each);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a template, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.toPrimitive] = hook;
  try {
    `${held}`;
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("string, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held["toString"] = hook;
  try {
    String(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("number, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held["valueOf"] = hook;
  try {
    Number(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("an addition, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held["valueOf"] = hook;
  try {
    held + 1;
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("json stringify, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held["toJSON"] = hook;
  try {
    JSON.stringify(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("json stringify, a field");
{
function scene() {
  class Held {}
  const held = new Held();
  const box = { ran: 0 };
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", box.ran);
  function hook() {
    ++box.ran;
    
    return { next: () => ({ done: true }) };
  }
  held["toJSON"] = hook;
  try {
    JSON.stringify(held);
  } catch (error) {}
  console.log("ran", box.ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("json stringify, a module variable");
{
function scene() {
  class Held {}
  const held = new Held();
  ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held["toJSON"] = hook;
  try {
    JSON.stringify(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("json stringify, an element");
{
function scene() {
  class Held {}
  const held = new Held();
  const list = [0];
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", list[0]);
  function hook() {
    ++list[0];
    
    return { next: () => ({ done: true }) };
  }
  held["toJSON"] = hook;
  try {
    JSON.stringify(held);
  } catch (error) {}
  console.log("ran", list[0]);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("instanceof, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.hasInstance] = hook;
  try {
    ({}) instanceof held;
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("string replace, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.replace] = hook;
  try {
    "text".replace(held, "");
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("string split, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  held[Symbol.split] = hook;
  try {
    "text".split(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array map, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].map(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array map, a field");
{
function scene() {
  class Held {}
  const held = new Held();
  const box = { ran: 0 };
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", box.ran);
  function hook() {
    ++box.ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].map(hook);
  } catch (error) {}
  console.log("ran", box.ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array map, a module variable");
{
function scene() {
  class Held {}
  const held = new Held();
  ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].map(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array map, an element");
{
function scene() {
  class Held {}
  const held = new Held();
  const list = [0];
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", list[0]);
  function hook() {
    ++list[0];
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].map(hook);
  } catch (error) {}
  console.log("ran", list[0]);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array for each, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].forEach(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array sort, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [2, 1].sort(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array find, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1].find(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array reduce, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    [1, 2].reduce(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("array from with a mapper, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    Array.from([1], hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("replace with a function, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    "text".replace("t", hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("json parse, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    JSON.parse("1", hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("reflect apply, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    Reflect.apply(hook, undefined, []);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("function call, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    hook.call(undefined);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("function apply, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    hook.apply(undefined, []);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a bound function, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    hook.bind(undefined)();
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a proxy trap, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    new Proxy({}, { get: hook }).member;
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by object assign, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    Object.assign({}, held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by object assign, a field");
{
function scene() {
  class Held {}
  const held = new Held();
  const box = { ran: 0 };
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", box.ran);
  function hook() {
    ++box.ran;
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    Object.assign({}, held);
  } catch (error) {}
  console.log("ran", box.ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by object assign, a module variable");
{
function scene() {
  class Held {}
  const held = new Held();
  ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    Object.assign({}, held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by object assign, an element");
{
function scene() {
  class Held {}
  const held = new Held();
  const list = [0];
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", list[0]);
  function hook() {
    ++list[0];
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    Object.assign({}, held);
  } catch (error) {}
  console.log("ran", list[0]);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by object entries, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    Object.entries(held);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a getter read by a spread, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  Object.defineProperty(held, "member", { get: hook, enumerable: true });
  try {
    ({ ...held });
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("map for each, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    new Map([[1, 1]]).forEach(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("set for each, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    new Set([1]).forEach(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a typed array map, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    new Uint8Array(1).map(hook);
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
console.log("a new promise, a captured variable");
{
function scene() {
  class Held {}
  const held = new Held();
  let ran = 0;
  const descriptor = { value: true };
  const descriptors = { size: descriptor };
  Object.defineProperties(held, descriptors);
  console.log("ran", ran);
  function hook() {
    ++ran;
    
    return { next: () => ({ done: true }) };
  }
  
  try {
    new Promise(hook).catch(() => {});
  } catch (error) {}
  console.log("ran", ran);
  
}
for (let i = 0; i < 2; i++) {
  scene();
}
}
