// `export * from` as TypeScript emits it for CommonJS, where Object.prototype gets names in front of the star or behind it. A compiled executable refuses every change of Object.prototype, and where the
// compiler sees the assignment the build says so.
"use strict";
const show = value => (typeof value === "function" ? String(value) : typeof value === "string" ? JSON.stringify(value) : String(value));
const describe = object =>
  Reflect.ownKeys(object)
    .map(key => {
      const d = Object.getOwnPropertyDescriptor(object, key);
      return `${String(key)}{${Object.keys(d).map(name => `${name}=${show(d[name])}`).join(" ")}}`;
    })
    .join(" ");
const valuesOf = object => Object.keys(object).map(key => `${key}=${show(object[key])}`).join(" ");
const getterOf = (object, key) => Object.getOwnPropertyDescriptor(object, key)?.get;
const attempt = work => {
  try {
    return show(work());
  } catch (error) {
    return `threw ${error.constructor.name}: ${error.message}`;
  }
};
const section = name => console.log(`--- ${name}`);
const listWithForIn = object => {
  const listed = [];
  for (const key in object) listed.push(key);
  return listed.join();
};

section("Object.prototype changes behind the star");
{
  const barrel = require("./prototype-changed-late/barrel.js");
  Object.prototype.inherited = "inherited";
  Object.prototype.configurable = true;
  Object.prototype.set = function () {};
  const described = describe(barrel);
  const listed = listWithForIn(barrel);
  delete Object.prototype.inherited;
  delete Object.prototype.configurable;
  delete Object.prototype.set;
  console.log(described);
  console.log(listed, attempt(() => delete barrel.one));
}

section("Object.prototype has a name that can be listed at the star");
{
  Object.prototype.inherited = "inherited";
  const barrel = require("./prototype-changed-early/barrel.js");
  delete Object.prototype.inherited;
  console.log(describe(barrel));
  console.log(valuesOf(barrel));
  require("./prototype-changed-early/leaf.js").inherited = "own by now";
  console.log(valuesOf(barrel));
}

section("descriptors inherit at the star");
{
  Object.prototype.configurable = true;
  const barrel = require("./descriptors-inherit/barrel.js");
  delete Object.prototype.configurable;
  console.log(describe(barrel));
  console.log(attempt(() => delete barrel.one), Object.keys(barrel).join());
}
