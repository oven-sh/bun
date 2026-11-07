export function make(kind) {
  switch (kind) {
    case 1:
      function useHandler() {
        "use memo";
        return () => 1;
      }
      return useHandler;
    default:
      return "none";
  }
}
