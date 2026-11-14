// Dates in UTC taken apart, formatted, moved by months and days
function show(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 23, 59, 58));
  const two = n => String(n).padStart(2, "0");
  const text = `${date.getUTCFullYear()}-${two(date.getUTCMonth() + 1)}-${two(date.getUTCDate())}T${two(date.getUTCHours())}`;
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(next.getUTCDate() + 30);
  return text + " " + next.toISOString() + " " + date.getUTCDay() + " " + (next - date) / 864e5;
}
console.log(show(2026, 11, 12));
console.log(show(2024, 2, 29));
console.log(show(1999, 12, 31));
