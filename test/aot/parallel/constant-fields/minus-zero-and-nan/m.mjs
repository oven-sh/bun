const z = -0, n = NaN;
export const read = () => [Object.is(z, -0), 1 / z, Object.is(n, NaN)].join();
