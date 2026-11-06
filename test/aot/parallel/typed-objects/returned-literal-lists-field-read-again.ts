// A returned literal lists a field read again behind a test for null.
declare const console: { log(...values: any[]): void };

const sources: Record<string, string> = { first: "remote", second: "default", third: "override" };
const thisProcess: { lastServed: boolean | null } = { lastServed: null };

function read(name: string): { isOn: boolean; source: string } {
  const source = sources[name];
  const isOn = name !== "third";
  if (source === "remote") {
    thisProcess.lastServed = isOn;
    return { isOn, source };
  }
  return thisProcess.lastServed === null ? { isOn, source: "disabled" } : { isOn: thisProcess.lastServed, source: "kept" };
}

for (const name of ["second", "constructor", "third", "first", "second", "constructor", "missing"]) {
  const { isOn, source } = read(name);
  console.log(name, isOn, source);
}
