const lines: string[] = [];
export function log(line: string): string[] { lines.push(line); return lines; }
log("log is evaluated");
