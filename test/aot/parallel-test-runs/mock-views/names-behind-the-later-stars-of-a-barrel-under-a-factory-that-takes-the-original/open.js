// A key that the run puts together: the build cannot tell what is read off the global object, `vi` and `mock` among it, so any module of the run may be mocked.
const key = ["perform", "ance"].join("");
export const byKeyOfTheRun = () => globalThis[key];
