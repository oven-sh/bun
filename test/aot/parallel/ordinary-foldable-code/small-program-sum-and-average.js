const SCORES = [88, 92, 79, 65, 95];
const total = SCORES.reduce((a, b) => a + b, 0);
const average = total / SCORES.length;
const best = Math.max(...SCORES);
const passed = SCORES.filter((s) => s >= 70).length;
const grade = average >= 90 ? "A" : average >= 80 ? "B" : "C";
console.log({ total, average, best, passed, grade });
