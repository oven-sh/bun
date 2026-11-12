// A copy onto the global object and a delete under a key made at run time leave what the library keeps there under names of its own.
// STATISTIC: ImageFunctionsEmitted <= 100 Todo: what this program reaches of Bun's library is not cut down to what it uses yet
Object.assign(globalThis, { double: n => n * 2, label: "two" });
delete globalThis[["Broadcast", "Channel"].join("")];
console.log(globalThis.double(21), globalThis.label, typeof BroadcastChannel);
