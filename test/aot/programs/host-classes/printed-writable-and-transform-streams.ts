// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a WritableStream and a TransformStream.
console.log(new WritableStream(), new TransformStream());
