// process.nextTick runs some forty functions of the library: the queue, its ring, a validator. They read each other's exports and a few private globals of Bun. None of those reads can hand out the symbol under which an object is printed, so what Bun prints objects with stays out.
// STATISTIC: ImageFunctionsEmitted <= 48
process.nextTick((a, b) => console.log({ a, b }), 1, [2]);
