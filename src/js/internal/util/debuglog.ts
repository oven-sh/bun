// Timing formatter shared by console.timeEnd/timeLog. Port of node v26.3.0
// lib/internal/util/debuglog.js formatTime, with the prototype methods
// captured at module load for tamper resistance.
const kSecond = 1000;
const kMinute = 60 * kSecond;
const kHour = 60 * kMinute;

const StringPrototypePadStart = String.prototype.padStart;
const StringPrototypeSplit = String.prototype.split;
const NumberPrototypeToFixed = Number.prototype.toFixed;
const MathFloor = Math.floor;
const NumberCtor = Number;

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
        hours = MathFloor(ms / kHour);
        ms = ms % kHour;
      }
      minutes = MathFloor(ms / kMinute);
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

  return `${NumberCtor(NumberPrototypeToFixed.$call(ms, 3))}ms`;
}

export default {
  formatTime,
};
