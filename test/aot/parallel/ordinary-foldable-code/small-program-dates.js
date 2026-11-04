const EPOCH = new Date(0);
const RELEASE = new Date("2024-02-29T12:00:00Z");
const days = Math.round((RELEASE - EPOCH) / 86400000);
console.log(EPOCH.toISOString(), RELEASE.getUTCFullYear(), RELEASE.getUTCMonth() + 1, RELEASE.getUTCDate(), days);
