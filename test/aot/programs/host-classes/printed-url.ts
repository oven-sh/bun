// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a URL, alone and inside other objects.
console.log(new URL("http://a/b?c=d"));
console.log([new URL("http://a/b")], { url: new URL("http://c") });
