let said = "";
for (let i = 0; i < 4; i++) { said += i + " "; }
try { JSON.parse(process.argv[2] ?? "{}"); } catch (e) { }
console.log(said);
