// Each of these modules declares a constant whose initializer throws. The error is thrown while the module is loaded, not when the constant is first read.
async function load(name: string, importing: () => Promise<{ made: unknown }>): Promise<void> {
  let loaded = false;
  try {
    const module = await importing();
    loaded = true;
    console.log(name + ":", typeof module.made);
  } catch (error) {
    console.log(name + ":", (error as Error).name, loaded ? "when it was read" : "while it was loaded");
  }
}
await load("a throw in a function", () => import("./a-throw-in-a-function"));
await load("a read of null", () => import("./a-read-of-null"));
await load("a read of null in the second iteration", () => import("./a-read-of-null-in-the-second-iteration"));
await load("a read of null in the second callback", () => import("./a-read-of-null-in-the-second-callback"));
await load("a call of undefined", () => import("./a-call-of-undefined"));
await load("a store to a frozen object", () => import("./a-store-to-a-frozen-object"));
await load("an assign to a frozen object", () => import("./an-assign-to-a-frozen-object"));
await load("a push to a frozen list", () => import("./a-push-to-a-frozen-list"));
await load("a definition on a frozen object", () => import("./a-definition-on-a-frozen-object"));
await load("a store under a getter", () => import("./a-store-under-a-getter"));
await load("a store to a module namespace", () => import("./a-store-to-a-module-namespace"));
await load("a throw in a getter", () => import("./a-throw-in-a-getter"));
await load("a throw in a constructor", () => import("./a-throw-in-a-constructor"));
await load("a constant declared below", () => import("./a-constant-declared-below"));
await load("a bigint and a number", () => import("./a-bigint-and-a-number"));
await load("a symbol in a template", () => import("./a-symbol-in-a-template"));
await load("a negative length", () => import("./a-negative-length"));
await load("a pattern that is no pattern", () => import("./a-pattern-that-is-no-pattern"));
await load("a spread of what cannot be iterated", () => import("./a-spread-of-what-cannot-be-iterated"));
await load("a proxy of null", () => import("./a-proxy-of-null"));
await load("text that is no json", () => import("./text-that-is-no-json"));
await load("a class that extends null is constructed", () => import("./a-class-that-extends-null-is-constructed"));
