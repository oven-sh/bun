export function clocks(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) said += Date.now() + "," + new Date().getTime() + ";";
  return said;
}
export function logs(lines: string[]): number {
  let sent = 0;
  for (let at = 0; at < lines.length; at++) {
    console.log(lines[at]);
    sent++;
  }
  return sent;
}
export function folders(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) said += typeof process.cwd() + process.cwd().length + ";";
  return said;
}
export function fetched(urls: string[]): string {
  let said = "";
  for (let at = 0; at < urls.length; at++) said += String(fetch(urls[at]!)) + ";";
  return said;
}
export function copies(rows: object[]): string {
  let said = "";
  for (let at = 0; at < rows.length; at++) said += JSON.stringify(structuredClone(rows[at]!)) + ";";
  return said;
}
export function later(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) said += typeof setTimeout(() => {}, 0) + ";";
  return said;
}
export function ticks(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) said += typeof performance.now() + (performance.now() >= 0) + ";";
  return said;
}
export function draws(count: number): string {
  let said = "";
  for (let at = 0; at < count; at++) said += (Math.random() < 1) + ",";
  return said;
}
