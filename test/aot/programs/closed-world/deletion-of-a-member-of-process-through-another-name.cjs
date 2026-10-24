// As deletion-of-a-named-member-of-process.cjs, through a constant that holds process.
const print = console.log;
const p = process;
print(delete p.features, typeof p.features);
print(typeof p.platform);
