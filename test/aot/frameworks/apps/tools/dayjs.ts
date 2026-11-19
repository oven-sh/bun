import dayjs from "dayjs";
import "dayjs/locale/de";
import customParseFormat from "dayjs/plugin/customParseFormat";
import duration from "dayjs/plugin/duration";
import relativeTime from "dayjs/plugin/relativeTime";
import utc from "dayjs/plugin/utc";

dayjs.extend(utc);
dayjs.extend(relativeTime);
dayjs.extend(customParseFormat);
dayjs.extend(duration);
const day = dayjs.utc("2019-01-25T10:30:00Z");
console.log(
  day.format("DD/MM/YYYY HH:mm dddd"),
  day.add(1, "month").startOf("week").toISOString(),
  day.diff("2018-06-05", "month", true).toFixed(3),
  day.isBefore(dayjs.utc("2020-01-01")),
  day.daysInMonth(),
);
console.log(
  day.from(dayjs.utc("2019-01-27")),
  day.locale("de").format("dddd, D. MMMM YYYY"),
  dayjs("12-25-1995", "MM-DD-YYYY").format("YYYY MMM D"),
  dayjs("nope").isValid(),
  dayjs.duration({ hours: 25, minutes: 5 }).humanize(),
  dayjs.duration(90061000).format("D[d] H[h] m[m] s[s]"),
);
