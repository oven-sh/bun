// Bun.cron converts a String object that is the schedule by calling its own toString.
let calls = 0;
const schedule = new String("0 0 1 1 *");
schedule.toString = () => {
  calls++;
  return "0 0 2 2 *";
};
const job = Bun.cron(schedule, () => {});
job.stop();
console.log(calls);
