let resolve;
export const gate = new Promise(done => {
  resolve = done;
});
export const open = () => resolve();
export const slow = async () => {
  await gate;
  return { name: "first" };
};
