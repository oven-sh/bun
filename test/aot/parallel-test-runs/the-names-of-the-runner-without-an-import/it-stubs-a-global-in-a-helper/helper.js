export const act = () => {
  vi.stubGlobal("Math", { max: () => 7 });
  console.log("Math.max", Math.max(1, 2));
  return () => vi.unstubAllGlobals();
};
