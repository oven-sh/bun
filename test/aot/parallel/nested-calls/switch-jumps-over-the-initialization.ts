function pick(k: number) {
  try {
    switch (k) {
      case 0:
        const f = () => "filled";
        return f();
      case 1:
        return f();
      default:
        return "none";
    }
  } catch (e) { return (e as Error).name; }
}
console.log(pick(0), pick(1), pick(2));
