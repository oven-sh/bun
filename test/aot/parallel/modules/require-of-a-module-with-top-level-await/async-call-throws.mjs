const begin = async () => {
  throw new RangeError("async-call-throws");
};
await begin();
export const name = "async-call-throws";
