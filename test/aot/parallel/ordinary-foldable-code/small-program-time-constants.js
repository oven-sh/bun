const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const TIMEOUTS = { short: 5 * SECOND, medium: 2 * MINUTE, long: HOUR / 2 };
console.log(DAY, TIMEOUTS, TIMEOUTS.long > TIMEOUTS.medium);
console.log(`${DAY / HOUR} hours, ${HOUR / MINUTE} minutes`);
