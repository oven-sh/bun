const lines: string[] = []
export function log(line: string): string { lines.push(line); return lines.join("\n") }
log("log evaluated")
