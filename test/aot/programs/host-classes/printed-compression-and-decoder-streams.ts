// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a CompressionStream and a TextDecoderStream.
console.log(new CompressionStream("gzip"), new TextDecoderStream());
