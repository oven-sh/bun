// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a stream out of a list, under an index that the build does not know.
const values: unknown[] = [Buffer.from("a"), new ReadableStream(), 1];
console.log(values[Number(process.argv[2] ?? 1)]);
