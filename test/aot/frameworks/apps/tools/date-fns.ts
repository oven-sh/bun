import {
  addBusinessDays,
  compareAsc,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  format,
  formatDistance,
  formatISO9075,
  intervalToDuration,
  isValid,
  parse,
  parseISO,
  startOfWeek,
  subDays,
} from "date-fns";
import { de, eo } from "date-fns/locale";

const date = new Date(2014, 1, 11, 10, 30);
console.log(
  format(date, "yyyy-MM-dd'T'HH:mm EEEE do QQQ"),
  format(date, "PPPP", { locale: de }),
  formatDistance(subDays(date, 3), date, { addSuffix: true }),
  formatDistance(subDays(date, 40), date, { locale: eo }),
);
console.log(
  [new Date(1995, 6, 2), new Date(1987, 1, 11), new Date(1989, 6, 10)]
    .sort(compareAsc)
    .map(each => each.getFullYear())
    .join(),
  differenceInCalendarDays(endOfMonth(date), date),
  formatISO9075(addBusinessDays(date, 5)),
  format(startOfWeek(date, { weekStartsOn: 1 }), "EEE d"),
);
console.log(
  eachDayOfInterval({ start: date, end: new Date(2014, 1, 13) }).length,
  JSON.stringify(intervalToDuration({ start: new Date(2000, 0, 1), end: date })),
  isValid(parseISO("2014-02-31")),
  format(parse("11/02/2014", "dd/MM/yyyy", new Date(0)), "MMM d"),
);
