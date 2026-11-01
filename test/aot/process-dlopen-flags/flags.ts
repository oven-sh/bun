// What process.dlopen makes of its third argument. Plain Bun and an --aot executable print the same lines.
const { RTLD_LAZY, RTLD_GLOBAL } = require("node:os").constants.dlopen;
const order: string[] = [];
const exported: any = {};
const core = {
  get exports() {
    order.push("exports");
    return exported;
  },
};
const flags = {
  valueOf() {
    order.push("flags");
    return RTLD_LAZY | RTLD_GLOBAL;
  },
};
process.dlopen(core, process.env.CORE!, flags as any);
console.log("converted:", order.join(", "));
// The plugin finds core_value() of the addon only if the addon was opened with RTLD_GLOBAL.
console.log("the plugin answers", exported.loadPlugin(process.env.PLUGIN));
for (const [what, load] of [
  ["a symbol for the flags", () => process.dlopen({ exports: {} }, process.env.CORE!, Symbol() as any)],
  ["one argument", () => (process.dlopen as any)({ exports: {} })],
] as const) {
  try {
    load();
    console.log(what, "loads");
  } catch (error: any) {
    console.log(what, "throws", error.name, error.code);
  }
}
