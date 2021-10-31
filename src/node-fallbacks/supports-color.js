var supportsColor;

if ("Bun" in globalThis) {
  if (Bun.enableANSIColors) {
    const colors = {
      level: 2,
      hasBasic: true,
      has256: true,
      has16m: false,
    };

    supportsColor = {
      stdout: colors,
      stderr: colors,
    };
  } else {
    supportsColor = {
      stdout: false,
      stderr: false,
    };
  }
} else {
  const isBlinkBasedBrowser = /\b(Chrome|Chromium)\//.test(navigator.userAgent);

  const colorSupport = isBlinkBasedBrowser
    ? {
        level: 1,
        hasBasic: true,
        has256: false,
        has16m: false,
      }
    : false;

  supportsColor = {
    stdout: colorSupport,
    stderr: colorSupport,
  };
}

export default supportsColor;
export const stdout = supportsColor.stdout;
export const stderr = supportsColor.stderr;
export { supportsColor };
