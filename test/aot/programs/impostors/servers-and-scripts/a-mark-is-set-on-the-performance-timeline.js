performance.mark("start");
console.log(performance.getEntriesByName("start").length, performance.mark === Performance.prototype.mark, Object.getOwnPropertyNames(performance));
