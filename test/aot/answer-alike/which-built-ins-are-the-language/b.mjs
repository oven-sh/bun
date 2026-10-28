// The program uses them too, in a line that never runs.
const decoded = text => Buffer.from(text).toString(); // text that is decoded at run time is unknown to the compiler
const unknown = value => new CustomEvent("unknown", { detail: value }).detail; // what native code hands back is unknown to the compiler
const never = process.argv.length > 99;
const say = async f => { let answer; try { answer = await f(); } catch (error) { answer = error.name + ": " + String(error.message).slice(0, 60); } console.log(answer); };
if (never) console.log(new Intl.NumberFormat("de").format(1), "a".localeCompare("b"), (1).toLocaleString("en"), "e".normalize("NFD"), new Date(0).toLocaleDateString("en"));
say(async () => new Function(decoded("return [new Intl.NumberFormat('de').format(1234.5), 'a'.localeCompare('b'), (1234.5).toLocaleString('en'), '\\u00e9'.normalize('NFD').length, new Date(0).toLocaleDateString('en', { timeZone: 'UTC' })].join('|')"))());
