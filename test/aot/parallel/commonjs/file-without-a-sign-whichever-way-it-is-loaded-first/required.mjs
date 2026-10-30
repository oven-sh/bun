export const whileRequired = import("./while-required.cjs");
export const [inCallback] = [0].map(() => import("./in-a-callback.cjs"));
export const inJob = Promise.resolve().then(() => import("./in-a-job.cjs"));
export const inTick = new Promise(resolve => process.nextTick(() => resolve(import("./in-a-tick.cjs"))));
export const inTimer = new Promise(resolve => setTimeout(() => resolve(import("./in-a-timer.cjs"))));
export const called = () => import("./called-later.cjs");
