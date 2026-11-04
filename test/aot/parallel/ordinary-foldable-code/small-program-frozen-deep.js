const THEME = Object.freeze({ colors: Object.freeze({ primary: "#09f", text: "#111" }), spacing: Object.freeze([0, 4, 8, 16]) });
let threw = false;
try {
  "use strict";
  THEME.colors.primary = "#000";
} catch {
  threw = true;
}
console.log(THEME.colors.primary, THEME.spacing[2], Object.isFrozen(THEME.spacing), typeof threw);
