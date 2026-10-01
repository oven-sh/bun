// Prints one line per case of an oracle output file. usage: node show.cjs <file>
const j = require(require("path").resolve(process.argv[2]));
for (const c of j)
	console.log(
		JSON.stringify(c.code),
		"=>",
		c.eslint ? c.eslint.map(m => `${m.line}:${m.column}-${m.endLine}:${m.endColumn} ${m.message}`).join(" | ") || "(none)" : "FATAL " + c.eslintFatal,
		c.bunSyntax ? " BUN:" + c.bunSyntax.join("|") : "",
		c.bunOther ? " OTHER:" + c.bunOther.join("|") : "",
	);
