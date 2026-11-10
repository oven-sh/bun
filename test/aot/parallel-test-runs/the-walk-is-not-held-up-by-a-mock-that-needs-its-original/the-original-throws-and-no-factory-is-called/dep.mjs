console.log("| body of dep");
throw new Error("dep fails");
export const get = () => "real";
