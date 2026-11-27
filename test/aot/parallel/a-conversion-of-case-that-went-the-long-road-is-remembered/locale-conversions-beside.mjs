const text = JSON.parse(JSON.stringify("Iİıi TITLE И"));
const out = []; for (let turn = 0; turn < 3; turn++) out.push(escape(text.toLowerCase()), escape(text.toLocaleLowerCase("tr")), escape(text.toUpperCase()), escape(text.toLocaleUpperCase("tr")), escape(text.toLocaleLowerCase("en")));
console.log(out.join(" "));
