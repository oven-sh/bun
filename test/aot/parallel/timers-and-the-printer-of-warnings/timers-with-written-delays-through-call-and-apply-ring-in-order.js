// The timer is entered through call(): what the build holds for that is not bounded here. The order of the bells is.
function ring(name, times) { console.log(name, times); }
setTimeout(ring, 3, "late", 2);
setTimeout.call(undefined, ring, 8, "last", 3);
setTimeout.apply(undefined, [ring, 0, "early", 1]);
