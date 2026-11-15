export const a = 1;
export const box = { n: 1 };
export const then = resolve => {
  console.log("then");
  resolve({ a: 2 });
};
