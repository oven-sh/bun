// A function of the host names a value that it refuses in the message of its error, and says there whether the object has properties of its own: fields that nobody reads count.
function told(run: () => unknown): string {
  try { run(); } catch (error: any) { return `${error.code}: ${error.message}`; }
  return "no error";
}
const values: any[] = [
  new (Object.defineProperty(class { x = 1; y = 2; }, "name", { get() { return "Computed"; } }))(),
  new (Object.defineProperty(class {}, "name", { get() { return "Computed"; } }))(),
  { __proto__: null, a: 1 },
  { __proto__: null },
  { get constructor() { return Object; }, b: 2 },
  Object.create({ get constructor() { return Object; } }),
  Object.assign(Object.create({ get constructor() { return Object; } }), { c: 3 }),
];
for (const value of values) console.log(told(() => Buffer.compare(value, Buffer.alloc(1))));
for (const value of values) console.log(told(() => Buffer.alloc(1).compare(value)));
for (const value of values) console.log(told(() => Buffer.byteLength(value)));
