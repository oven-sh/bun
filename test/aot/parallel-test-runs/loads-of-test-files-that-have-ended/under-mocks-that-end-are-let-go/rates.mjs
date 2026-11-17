const rates = Array.from({ length: 524288 }, (_, i) => i + 0.5);
export const rate = (i) => rates[i];
