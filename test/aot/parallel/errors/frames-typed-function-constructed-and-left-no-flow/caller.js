const frames = error => String(error?.stack).split("\n").slice(1, 4).map(line => line.trim().replace(/^at /, "").replace(/\(.*[\\/]/, "(")).join(" < ");
export function construct(callee, given) {
  try {
    const made = new callee(given[0], given[1]);
    return typeof made;
  } catch (error) {
    return frames(error);
  }
}
