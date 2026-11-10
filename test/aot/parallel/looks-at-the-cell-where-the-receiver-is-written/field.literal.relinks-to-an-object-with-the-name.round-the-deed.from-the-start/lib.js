const again = Number(process.argv.length > 99);
function make(i, has) { const o = { issues: i }; if (has) o.aborted = 5; return o; }
function read(o, deed) { const before = o.aborted; if (deed) deed(o); const behind = o.aborted; return String(before) + "," + String(behind); }
export { make, read };
