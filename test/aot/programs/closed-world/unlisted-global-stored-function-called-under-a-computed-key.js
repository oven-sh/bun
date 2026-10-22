globalThis.__calledUnderAKey = value => "called with " + value;
const key = "__calledUnder" + (process.env.REST ?? "AKey");
console.log(globalThis[key](2), Reflect.get(globalThis, key)(3), Reflect.apply(globalThis[key], undefined, [4]));
