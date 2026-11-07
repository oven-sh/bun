const print = console.log;
print(Reflect.deleteProperty(process, "features"), typeof process.features);
print(typeof process.platform);
