// Part of indirect-eval-import-origin.
const counts = ((globalThis as any).originEvaluations ??= {}); counts["nested/target"] = (counts["nested/target"] ?? 0) + 1;
export const token = { name: "nested/target" };
