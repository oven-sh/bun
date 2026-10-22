performance.mark("start");
const measure = performance.measure("span", "start");
console.log(measure.name, typeof measure.duration, typeof performance.now(), typeof performance.timeOrigin, typeof performance.toJSON().timeOrigin);
