const print = console.log;
const key = JSON.parse("\"features\"");
print(delete process[key], typeof process.features);
print(typeof process.platform);
