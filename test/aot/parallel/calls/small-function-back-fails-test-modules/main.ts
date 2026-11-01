// Imports three modules, one after the other. An inner function of the second calls a small generic function in front of a try, with a value that is not of the type declared for the result.
await import("./a-class-with-a-decorated-field-and-method.ts");
await import("./a-getter-whose-inner-function-calls-the-small-function.ts");
await import("./values-handed-through-helpers-and-constructor-functions.ts");
export {};
