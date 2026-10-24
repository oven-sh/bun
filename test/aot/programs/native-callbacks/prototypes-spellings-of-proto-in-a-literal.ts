// Only `__proto__: value` and `"__proto__": value` set the prototype. A computed key, a method and parsed text make an own property.
const key = "__proto__";
const plain: any = { __proto__: null };
const quoted: any = { "__proto__": null };
const computed: any = { [key]: null };
const constantKey: any = { ["__proto__"]: null };
const method: any = { __proto__() { return 1; } };
const parsed: any = JSON.parse('{ "__proto__": null }');
for (const [name, made] of Object.entries({ plain, quoted, computed, constantKey, method, parsed })) {
  console.log(name, typeof made.toString, Object.getPrototypeOf(made) === null, Object.getOwnPropertyNames(made).length);
}
