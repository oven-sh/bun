// Each module defines a class under void or ! whose result nothing uses, and most of the definitions throw or run code. Plain Bun prints another output.
const modules = [
  ["void", () => import("./void.js")],
  ["not", () => import("./not.js")],
  ["void-null", () => import("./void-null.js")],
  ["not-class", () => import("./not-class.js")],
  ["void-key", () => import("./void-key.js")],
  ["not-key", () => import("./not-key.js")],
  ["void-static-prototype", () => import("./void-static-prototype.js")],
  ["not-static-prototype", () => import("./not-static-prototype.js")],
];
for (const [name, load] of modules) {
  try {
    await load();
    console.log(name, "loaded");
  } catch (error) {
    console.log(name, error.name, error.message);
  }
}
/* Output:
void TypeError The superclass is not a constructor.
not TypeError The superclass is not a constructor.
void-null loaded
not-class loaded
converted
void-key loaded
converted
not-key loaded
void-static-prototype TypeError Attempting to change configurable attribute of unconfigurable property.
not-static-prototype TypeError Cannot declare a static field named 'prototype'
*/
