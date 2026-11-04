// No type is written at the parse: the result enters a declared variable, a declared parameter, a declared result, behind an await too, and two positions of types that do not agree. The texts fit the types or do not.
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a layout that parsers make
type Config = { port: number; host: string };
type Other = { name: string };
function assigned(text: string) { const config: Config = JSON.parse(text); return config; }
function start(config: Config) { return String(config.port) + "@" + String(config.host); }
function passed(text: string) { return start(JSON.parse(text)); }
function returned(text: string): Config { return JSON.parse(text); }
async function awaited(text: string) { const config: Config = await JSON.parse(text); return config; }
async function body(text: string) { const config: Config = await new Response(text).json(); return config; }
function torn(text: string) { const value = JSON.parse(text); const config: Config = value; const other: Other = value; return String(config.port) + String(other.name); }
const texts = ['{"port":1,"host":"a"}', '{"host":"b","port":2}', '{"port":"3"}', '{"name":"n"}', '{"port":4,"host":"c","name":"n"}', "[1]", "null", "5", '"text"'];
for (let round = 0; round < 3; round++) {
  for (const text of texts) {
    const lines: string[] = [];
    for (const f of [() => JSON.stringify(assigned(text)), () => passed(text), () => JSON.stringify(returned(text)), () => torn(text)]) {
      try { lines.push(f()); } catch (error) { lines.push((error as Error).name); }
    }
    lines.push(JSON.stringify(await awaited(text)), JSON.stringify(await body(text)));
    console.log(lines.join(" | "));
  }
}
