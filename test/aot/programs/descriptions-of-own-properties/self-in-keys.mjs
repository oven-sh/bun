// globalThis.self is an accessor, as in a browser: the getter answers the global object, and a store puts a data property in its place.
console.log("self" in globalThis, Object.keys(globalThis).includes("self"), Object.hasOwn(globalThis, "self"), globalThis.propertyIsEnumerable("self"));
