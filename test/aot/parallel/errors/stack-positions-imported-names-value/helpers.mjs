export let counter = 0;
export function step(n) {
  if (n === 2) throw new Error("step " + n);
  return n;
}
export const show = (label, error) =>
  console.log(
    label +
      " | " +
      String(error && error.message) +
      " | " +
      String(error && error.stack)
        .split("\n")
        .slice(1, 6)
        .map(line => line.trim().replace(/\(?[^ (]*[\\/]([^\\/ ]+:\d+:\d+)\)?/, "$1"))
        .join(" < "),
  );
