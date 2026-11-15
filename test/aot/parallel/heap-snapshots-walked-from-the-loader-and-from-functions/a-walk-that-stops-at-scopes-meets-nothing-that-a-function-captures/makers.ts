export function makeCounter() {
  const steps = new Map<string, number>([["one", 1]]);
  let count = 0;
  return () => (count += steps.get("one")!);
}
export function makeLogger() {
  const lines = new Set<string>();
  const write = (line: string) => void lines.add(line);
  return { info: (line: string) => write("info " + line), error: (line: string) => write("error " + line) };
}
function takesReceiver(this: Map<string, number>, key: string) {
  return this.get(key);
}
export function makeBound() {
  return takesReceiver.bind(new Map([["two", 2]]), "two");
}
export function touchesNothing() {
  return 1;
}
