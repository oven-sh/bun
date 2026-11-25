let loads = (globalThis.loadsOfLibrary = (globalThis.loadsOfLibrary ?? 0) + 1);
export function isWordCharacter(code) {
  if (code >= 97 && code <= 122) return true;
  if (code >= 65 && code <= 90) return true;
  if (code >= 48 && code <= 57) return true;
  return code === 95;
}
export function whichLoad() {
  return loads;
}
