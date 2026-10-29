// Part of indirect-eval-import-origin.
const counts = ((globalThis as any).originEvaluations ??= {}); counts["target"] = (counts["target"] ?? 0) + 1;
export const token = { name: "target beside main" };
