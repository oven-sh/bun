const again = Number(process.argv.length > 99);
function Old(i) { this.issues = i; }
Old.prototype.size = function () { return 1; };
function make(i) { return new Old(i); }
function read(o, deed) { let said = ""; try { said += String(o.aborted); if (deed) deed(o); if (o.aborted !== undefined) throw new Error("there"); said += "-"; } catch (e) { said += e.message + String(o.aborted); } finally { said += String(o.aborted); } return said; }
export { make, read };
export { Old };
