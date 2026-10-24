// The initializer of a top-level constant calls a function that reads a constant declared further down: a ReferenceError, thrown while the module is loaded, whatever form the initializer has. Where the call is only kept for later, the module loads, and the later call finds the constant initialized.
function show(value: unknown): string { return JSON.stringify(value, (key, held) => (typeof held === "function" ? "function " + String((held as () => unknown)()) : held instanceof Map || held instanceof Set ? [...held] : held)); }
async function load(name: string, importing: () => Promise<{ made: unknown }>): Promise<void> {
  let loaded = false;
  try {
    const module = await importing();
    loaded = true;
    console.log(name + ":", show(module.made));
  } catch (error) {
    console.log(name + ":", (error as Error).name, loaded ? "when it was read" : "while it was loaded");
  }
}
await load("a literal", () => import("./a-literal"));
await load("a list", () => import("./a-list"));
await load("a computed key", () => import("./a-computed-key"));
await load("a spread of a getter", () => import("./a-spread-of-a-getter"));
await load("an assign of a getter", () => import("./an-assign-of-a-getter"));
await load("values of a getter", () => import("./values-of-a-getter"));
await load("a callback of map", () => import("./a-callback-of-map"));
await load("a callback of filter", () => import("./a-callback-of-filter"));
await load("a loop", () => import("./a-loop"));
await load("a helper", () => import("./a-helper"));
await load("a default of a parameter", () => import("./a-default-of-a-parameter"));
await load("a constructor", () => import("./a-constructor"));
await load("a field initializer", () => import("./a-field-initializer"));
await load("a function called where it stands", () => import("./a-function-called-where-it-stands"));
await load("a map", () => import("./a-map"));
await load("a set", () => import("./a-set"));
await load("a frozen literal", () => import("./a-frozen-literal"));
await load("a test", () => import("./a-test"));
await load("a template", () => import("./a-template"));
await load("a cast", () => import("./a-cast"));
await load("kept in a getter", () => import("./kept-in-a-getter"));
await load("kept in a method", () => import("./kept-in-a-method"));
await load("kept in an arrow", () => import("./kept-in-an-arrow"));
await load("kept in a callback over an empty list", () => import("./kept-in-a-callback-over-an-empty-list"));
await load("kept in an arm that is not taken", () => import("./kept-in-an-arm-that-is-not-taken"));
