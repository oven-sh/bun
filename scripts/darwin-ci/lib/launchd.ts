export type PlistValue = string | number | boolean | PlistValue[] | { [key: string]: PlistValue };

function escape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function value(v: PlistValue): string {
  if (typeof v === "string") return `<string>${escape(v)}</string>`;
  if (typeof v === "number") return `<integer>${v}</integer>`;
  if (typeof v === "boolean") return v ? "<true/>" : "<false/>";
  if (Array.isArray(v)) return `<array>${v.map(value).join("")}</array>`;
  return `<dict>${Object.entries(v)
    .map(([k, inner]) => `<key>${escape(k)}</key>${value(inner)}`)
    .join("")}</dict>`;
}

export function plist(entries: { [key: string]: PlistValue }): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">${value(entries)}</plist>`,
    "",
  ].join("\n");
}
