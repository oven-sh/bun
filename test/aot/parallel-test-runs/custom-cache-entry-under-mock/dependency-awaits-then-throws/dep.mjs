await new Promise(done => setTimeout(done, 20));
throw new RangeError("dep fails");
export const value = "real";
