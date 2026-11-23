let heard = 0;
process.on("warning", warning => console.log("heard", ++heard, warning.name));
const ring = name => console.log("rang", name);
setTimeout.call(undefined, ring, -1, "call");
setTimeout.apply(undefined, [ring, -2, "apply"]);
Reflect.apply(setTimeout, undefined, [ring, -3, "reflect"]);
setTimeout.bind(undefined, ring, -4, "bind")();
