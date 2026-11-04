export const later = import("./dynamic-b.js").then(ns => ns.seen);
export function h() { return "h"; }
export function setH(v) { h = v; }
