// Each line names a module or a member of Bun that nothing else in the program names, on what was made of all the properties of process, Bun or the global object.
const url = "postgres://127.0.0.1:1/x";

console.log(typeof Object.create(null, Object.getOwnPropertyDescriptors(process)).getBuiltinModule("node:os").cpus);
console.log(
  typeof (({ getBuiltinModule }) => getBuiltinModule.value)(Object.getOwnPropertyDescriptors(process))("node:path")
    .join,
);
console.log(typeof Object.getOwnPropertyDescriptors({ ...process }).getBuiltinModule.value("node:url").parse);
console.log(typeof { ...Object.getOwnPropertyDescriptors(process) }.getBuiltinModule.value("node:util").format);
console.log(
  typeof Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(process))).getBuiltinModule.value(
    "node:events",
  ).once,
);
console.log(typeof new Map(Object.entries(process)).get("getBuiltinModule")("node:querystring").parse);

console.log(typeof new new Proxy({}, { get: (target, key) => Bun[key] }).SQL(url));
console.log(await new Proxy({}, { get: (target, key) => Reflect.get(Bun, key) }).peek(Promise.resolve(3)));
console.log(Object.create(null, Object.getOwnPropertyDescriptors(globalThis)).Bun.$.braces("{a,b}").join());
console.log(typeof Object.getOwnPropertyDescriptors({ ...globalThis }).Bun.value.sql.begin);
console.log(
  typeof Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(globalThis))).Bun.value.postgres.begin,
);
