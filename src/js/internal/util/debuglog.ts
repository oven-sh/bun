// Timing formatter shared by console.timeEnd/timeLog; node exposes it from
// internal/util/debuglog, and its tests import it from there.
const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

function pad(value) {
  return `${value}`.padStart(2, "0");
}

function formatTime(ms: number) {
  let hours = 0;
  let minutes = 0;
  let seconds: string | number = 0;

  if (ms >= kSecond) {
    if (ms >= kMinute) {
      if (ms >= kHour) {
        hours = Math.floor(ms / kHour);
        ms = ms % kHour;
      }
      minutes = Math.floor(ms / kMinute);
      ms = ms % kMinute;
    }
    seconds = ms / kSecond;
  }

  if (hours !== 0 || minutes !== 0) {
    ({ 0: seconds, 1: ms } = (seconds as number).toFixed(3).split(".") as any);
    const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
    return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
  }

  if (seconds !== 0) {
    return `${(seconds as number).toFixed(3)}s`;
  }

  return `${Number(ms.toFixed(3))}ms`;
}

export default {
  formatTime,
};
