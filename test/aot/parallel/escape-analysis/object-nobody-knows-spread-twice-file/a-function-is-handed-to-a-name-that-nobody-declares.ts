{
  function show(value: any): string {
    return typeof value === "function"
      ? "function " + value.name
      : Array.isArray(value)
        ? "[" + value.map(show).join() + "]"
        : typeof value === "object" && value !== null
          ? Object.prototype.toString.call(value)
          : typeof value + " " + String(value);
  }
  try {
    // @ts-ignore
    show = launder(show);
  } catch (error) {
    console.log((error as Error).name);
  }
}
