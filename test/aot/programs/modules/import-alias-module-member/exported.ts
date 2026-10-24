import * as ns from "./values";
namespace local { export function h() { return "h"; } }
export import f = ns.f;
export import m = ns.m;
export import K = ns.K;
export import inner = ns.inner;
export import h = local.h;
export function bumped() { const was = m; ns.bump(); return m === was && ns.m !== was; }
