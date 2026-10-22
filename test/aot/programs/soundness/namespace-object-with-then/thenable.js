let count = 0;
export function then(resolve) { count++; resolve("late"); }
export function calls() { return count; }
