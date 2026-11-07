// Bun.cron keeps the object that it is handed as its schedule, and the getter hands it out again. What is stored through the getter is stored in that object.
class Schedule extends String {
  n = 0;
}
function run() {
  const schedule = new Schedule("* * * * *");
  const job = Bun.cron(schedule, () => {});
  job.cron.n = 5;
  job.stop();
  return schedule.n;
}
console.log(run(), run());
