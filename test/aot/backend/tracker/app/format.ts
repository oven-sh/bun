const dayFormat = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

const minuteFormat = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

const numberFormat = new Intl.NumberFormat("en-US");

/** Oct 16, 2026 */
export function formatDay(date: Date): string {
  return dayFormat.format(date);
}

/** Oct 16, 2026, 13:45 */
export function formatMinute(date: Date): string {
  return minuteFormat.format(date);
}

/** 1,234,567 */
export function formatNumber(n: number): string {
  return numberFormat.format(n);
}

/** 1 comment, 2 comments, 1,234 comments */
export function formatCount(n: number, singular: string, plural = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : plural}`;
}

export function timeTag(date: Date, text = formatDay(date)): string {
  return `<time datetime="${date.toISOString()}">${text}</time>`;
}
