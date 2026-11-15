// A class of days over UTC times, compared, stepped and printed
class Day {
  constructor(private readonly time: number) {}
  static of(year: number, month: number, day: number): Day {
    return new Day(Date.UTC(year, month - 1, day));
  }
  plus(days: number): Day {
    return new Day(this.time + days * 864e5);
  }
  until(other: Day): number {
    return (other.time - this.time) / 864e5;
  }
  get text(): string {
    return new Date(this.time).toISOString().slice(0, 10);
  }
  get weekend(): boolean {
    return new Date(this.time).getUTCDay() % 6 === 0;
  }
}
function plan(year: number, month: number, days: number): string {
  const first = Day.of(year, month, 1);
  const all = Array.from({ length: days }, (_, i) => first.plus(i * 5));
  return all.map(day => day.text.slice(5) + (day.weekend ? "*" : "")).join(" ") + " " + first.until(Day.of(year + 1, 1, 1));
}
console.log(plan(2026, 11, 3));
console.log(plan(2024, 2, 5));
console.log(plan(2000, 12, 1));
