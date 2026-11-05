// `timing` and toJSON() of performance answer objects that the table describes, so the printer finds nothing that nobody knows and util.inspect stays out.
// STATISTIC: ImageFunctionsEmitted <= 8
console.log(Bun.inspect(performance).replace(/timeOrigin: [\d.]+/, "timeOrigin: a number"));
console.log(performance.timing);
console.log(performance.timing.toJSON());
console.log(Object.keys(performance.toJSON()), typeof performance.toJSON().timeOrigin);
console.log(performance.nothing, performance.timing.nothing, performance.toJSON().nothing);
