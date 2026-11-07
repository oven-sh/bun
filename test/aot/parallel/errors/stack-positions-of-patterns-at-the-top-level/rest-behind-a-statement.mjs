const holder = {
  get bad() {
    throw new Error("getter");
  },
  fine: 1,
};
const label = String(1);
const { fine, ...rest } = holder;
export { fine, label, rest };
