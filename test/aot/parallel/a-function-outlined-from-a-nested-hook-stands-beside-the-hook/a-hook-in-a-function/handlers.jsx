export function make() {
  function useHandler() {
    "use memo";
    return () => 1;
  }
  return useHandler;
}
