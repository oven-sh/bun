// @ts-nocheck
// The process's time zone changes while the program runs (process.env.TZ = ..). Formatters without a timeZone option made from constants must do what formatters made from opaque arguments do: before, after, and after changing back.
const boxes = []; const hide = x => { boxes.push(x); return boxes.pop(); };
let cases = 0, mismatches = 0;
const differ = (label, a, b) => { cases++; if (a !== b) { mismatches++; console.log("MISMATCH " + label + " | constant " + JSON.stringify(a) + " | twin " + JSON.stringify(b)); } };
const stamps = [0, 1234567890123, Date.UTC(2024, 2, 10, 9, 59, 59, 999), Date.UTC(2024, 2, 10, 10), Date.UTC(2024, 6, 1, 12), Date.UTC(2024, 11, 31, 23, 59, 59), Date.UTC(1900, 0, 1), Date.UTC(2100, 5, 5, 5, 5, 5)];
const atStart = new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "medium" }), atStartTwin = new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "short", timeStyle: "medium" }));
const unused = new Intl.DateTimeFormat("de", { hour: "2-digit", minute: "2-digit", day: "2-digit" }), unusedTwin = new Intl.DateTimeFormat(hide("de"), hide({ hour: "2-digit", minute: "2-digit", day: "2-digit" }));
const kept = [], keptTwins = [];
function check(when) {
  for (const t of stamps) {
    const d = new Date(t);
    differ(when + ": made at the start " + t, atStart.format(d), atStartTwin.format(d));
    differ(when + ": made now " + t, new Intl.DateTimeFormat("en-US", { dateStyle: "short", timeStyle: "medium" }).format(d), new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "short", timeStyle: "medium" })).format(d));
    differ(when + ": toLocaleString " + t, d.toLocaleString("en-US", { dateStyle: "short", timeStyle: "medium" }), d.toLocaleString(hide("en-US"), hide({ dateStyle: "short", timeStyle: "medium" })));
    differ(when + ": toLocaleTimeString " + t, d.toLocaleTimeString("de", { hour: "2-digit", minute: "2-digit" }), d.toLocaleTimeString(hide("de"), hide({ hour: "2-digit", minute: "2-digit" })));
    differ(when + ": toLocaleDateString " + t, d.toLocaleDateString("ja", {}), d.toLocaleDateString(hide("ja"), hide({})));
    differ(when + ": getHours agrees " + t, String(d.getHours()).padStart(2, "0"), new Intl.DateTimeFormat(hide("en-US"), hide({ hour: "2-digit", hourCycle: "h23" })).format(d));
    kept.forEach((f, i) => differ(when + ": made in zone " + i + " " + t, f.format(d), keptTwins[i].format(d)));
  }
  differ(when + ": resolved zone, made at the start", atStart.resolvedOptions().timeZone, atStartTwin.resolvedOptions().timeZone);
  differ(when + ": resolved zone, made now", new Intl.DateTimeFormat("en-US", { dateStyle: "short" }).resolvedOptions().timeZone, new Intl.DateTimeFormat(hide("en-US"), hide({ dateStyle: "short" })).resolvedOptions().timeZone);
  kept.push(new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" })); keptTwins.push(new Intl.DateTimeFormat(hide("en-GB"), hide({ dateStyle: "medium", timeStyle: "short" })));
}
check("at the start");
for (const zone of ["Asia/Tokyo", "Europe/London", "America/St_Johns", "Asia/Kathmandu", "UTC", "Pacific/Apia", "America/Los_Angeles", "Foo/Bar", "", "Australia/Lord_Howe"]) { process.env.TZ = zone; check("TZ = " + JSON.stringify(zone)); }
delete process.env.TZ; check("TZ deleted");
process.env.TZ = "Asia/Tokyo"; differ("first used after the change", unused.format(0), unusedTwin.format(0));
console.log("cases " + cases + " | mismatches " + mismatches);
