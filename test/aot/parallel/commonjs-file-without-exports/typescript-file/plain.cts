const scope: { runs?: number } = globalThis as never;
scope.runs = (scope.runs ?? 0) + 1;
console.log("run " + scope.runs, (function (this: unknown) { return this === undefined ? "strict" : "sloppy"; })());
