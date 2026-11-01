class Settings {
  static VERSION = "1.0.0";
  static DEBUG = false;
  static LIMITS = { max: 100, min: 1 };
  static get label() {
    return `settings ${Settings.VERSION}${Settings.DEBUG ? " (debug)" : ""}`;
  }
  static clamp(n) {
    return Math.min(Settings.LIMITS.max, Math.max(Settings.LIMITS.min, n));
  }
}
console.log(Settings.label, Settings.clamp(500), Settings.clamp(-5), Settings.clamp(50));
