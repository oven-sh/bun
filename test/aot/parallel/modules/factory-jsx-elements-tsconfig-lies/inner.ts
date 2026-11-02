export function h(tag: any, props: any, ...children: any[]) {
  return [typeof tag === "string" ? tag : typeof tag, props && Object.keys(props).join(), children.flat().join("|")].join(":");
}
export const Fragment = "fragment";
export const s = "s";
