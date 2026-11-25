export function make(n: number) {
  enum Mode {
    A = n,
  }
  function useHandler() {
    "use memo";
    return () => Mode.A;
  }
  return useHandler;
}
