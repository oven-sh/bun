// As deletion-of-a-named-member-of-process.cjs, with the name in brackets.
const print = console.log;
print(delete process["features"], typeof process.features);
print(typeof process.platform);
