// What cannot be called: native code converts it and the object stays with whoever made it.
const place = new URL("http://host.example/path");
place.hash = "mark";
place.port = 8080;
place.search = "a=1";
console.log(place.href, place.hash, place.port, typeof place.port);
const stop = new AbortController();
stop.signal.onabort = null;
console.log(stop.signal.onabort, stop.signal.aborted);
place.extra = "own";
console.log(place.extra, Object.keys(place).join());
