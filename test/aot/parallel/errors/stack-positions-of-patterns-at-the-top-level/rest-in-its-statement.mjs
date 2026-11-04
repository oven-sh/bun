const holder = {
  get bad() {
    throw new Error("getter");
  },
  fine: 1,
};
// prettier-ignore
const label = String(
  1,
), { fine, ...rest } = holder;
export { fine, label, rest };
