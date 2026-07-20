// Timing formatter shared by console.timeEnd/timeLog; node exposes it from
// internal/util/debuglog, and its tests import it from there.
const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeSplit = String.prototype.split;
const NumberPrototypeToFixed = Number.prototype.toFixed;

function pad(value) {
  return StringPrototypePadStart.$call(`${value}`, 2, "0");
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
    ({ 0: seconds, 1: ms } = StringPrototypeSplit.$call(NumberPrototypeToFixed.$call(seconds, 3), ".") as any);
    const res = hours !== 0 ? `${hours}:${pad(minutes)}` : minutes;
    return `${res}:${pad(seconds)}.${ms} (${hours !== 0 ? "h:m" : ""}m:ss.mmm)`;
  }

  if (seconds !== 0) {
    return `${NumberPrototypeToFixed.$call(seconds, 3)}s`;
  }

  return `${Number(NumberPrototypeToFixed.$call(ms, 3))}ms`;
}

export default {
  formatTime,
};
