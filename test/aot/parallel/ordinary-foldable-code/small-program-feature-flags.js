const FEATURES = { darkMode: true, betaSearch: false, newCheckout: false, analytics: true };
const enabled = Object.entries(FEATURES).filter(([, on]) => on).map(([name]) => name);
console.log(enabled.join(", "));
if (FEATURES.betaSearch) console.log("beta search is on");
console.log(FEATURES.darkMode ? "dark" : "light");
