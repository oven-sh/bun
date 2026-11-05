console.log("awaits-a-rejected-promise runs");
export const v = await Promise.reject(new RangeError("rejected at once"));
