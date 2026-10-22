// The `name` of a function, method, accessor or class that an object literal defines under a computed key that is a number.
enum K { A, B }

const nameAt = (o: any, key: any): string => o[key].name;
const getterAt = (o: object, key: any) => Object.getOwnPropertyDescriptor(o, key)!.get!;
const setterAt = (o: object, key: PropertyKey) => Object.getOwnPropertyDescriptor(o, key)!.set!;
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));

show("method", nameAt({ [1 + 1]() {} }, 2));
show("method with super", nameAt({ [1 + 1]() { return super.x; } }, 2));
show("generator method with super", nameAt({ *[1 + 1]() { yield super.x; } }, 2));
show("async method with super", nameAt({ async [1 + 1]() { return super.x; } }, 2));
show("arrow function under an enum member", nameAt({ [K.A]: () => 1 }, 0));
show("function expression under an enum member", nameAt({ [K.B]: function () {} }, 1));
show("class expression under an enum member", nameAt({ [K.B]: class {} }, 1));
show("named function expression keeps its name", nameAt({ [K.B]: function own() {} }, 1));
show("getter", getterAt({ get [1 + 1]() { return 1; } }, 2).name);
show("getter with super", getterAt({ get [2]() { return super.x; } }, 2).name);
show("setter", setterAt({ set [1 + 2](v: number) {} }, 3).name);
show("setter with super", setterAt({ set [K.B](v: number) { super.x = v; } }, 1).name);

function methodName(key: number) { return nameAt({ [key]() { return super.x; } }, key); }
function arrowName(key: number) { return nameAt({ [key]: () => key }, key); }
function getterName(key: number) { return getterAt({ get [key]() { return super.x; } }, key).name; }
for (const key of [0, 7, -1, 0.5, -0, 4294967295, 1e21, 1e-7, NaN, Infinity, -Infinity]) {
  show(Object.is(key, -0) ? "-0" : String(key), [methodName(key), arrowName(key), getterName(key)]);
}

function untypedNames(key: any) {
  return [nameAt({ [key]() { return super.x; } }, key), nameAt({ [key]: () => 1 }, key), getterAt({ get [key]() { return super.x; } }, key).name];
}
show("bigint", untypedNames(5n));
show("boolean", untypedNames(true));
show("null", untypedNames(null));
show("undefined", untypedNames(undefined));
show("string", untypedNames("text"));
show("symbol", untypedNames(Symbol("tag")));
show("symbol without a description", untypedNames(Symbol()));

let conversions = 0;
const counted: any = { toString() { conversions++; return "counted"; } };
show("object", [nameAt({ [counted]() { return super.x; } }, "counted"), nameAt({ [counted]: () => 1 }, "counted"), conversions]);

const derived: any = { __proto__: { x: "inherited" }, [1 + 1]() { return super.x; }, get [K.B]() { return super.x; } };
show("the home object is the literal", [derived[2](), derived[1], Object.keys(derived)]);
